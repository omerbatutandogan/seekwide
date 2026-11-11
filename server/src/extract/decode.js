// Content type and character set handling for HTTP responses. Pure.

const HTML_TYPES = new Set(['text/html', 'application/xhtml+xml']);
const PRESCAN_BYTES = 2048;
const SNIFF_BYTES = 1024;

/**
 * Media type of a `Content-Type` value: lower-cased, without parameters.
 * @param {string|undefined} contentType
 * @returns {string|null} null when the header is missing or empty.
 */
export function mediaTypeOf(contentType) {
  if (typeof contentType !== 'string') return null;
  const type = contentType.split(';', 1)[0].trim().toLowerCase();
  return type === '' ? null : type;
}

/**
 * Whether a response is HTML. A declared media type decides on its own; with no
 * `Content-Type`, the body is HTML when it starts with `<!doctype html` or
 * `<html` (after a BOM, whitespace, comments and an XML declaration).
 * @param {string|null} mediaType
 * @param {Buffer|null} body
 * @returns {boolean}
 */
export function isHtmlResponse(mediaType, body) {
  if (mediaType !== null) return HTML_TYPES.has(mediaType);
  if (!body || body.length === 0) return false;
  let head = body.subarray(0, SNIFF_BYTES).toString('latin1').toLowerCase();
  head = head.replace(/^(\xef\xbb\xbf|\xff\xfe|\xfe\xff)/, '');
  let previous;
  do {
    previous = head;
    head = head.replace(/^\s+/, '').replace(/^<!--[\s\S]*?-->/, '').replace(/^<\?xml[^>]*>/, '');
  } while (head !== previous);
  return head.startsWith('<!doctype html') || head.startsWith('<html');
}

/**
 * Canonical encoding name for a charset label, or null when the label is unknown.
 * @param {string|null|undefined} label
 * @returns {string|null}
 */
function encodingFor(label) {
  if (!label) return null;
  try {
    return new TextDecoder(label.trim()).encoding;
  } catch {
    return null;
  }
}

/**
 * @param {string|undefined} contentType
 * @returns {string|null}
 */
function headerCharset(contentType) {
  if (typeof contentType !== 'string') return null;
  const match = /;\s*charset\s*=\s*["']?([^"';\s]+)/i.exec(contentType);
  return match ? match[1] : null;
}

/**
 * @param {Buffer} body
 * @returns {string|null}
 */
function bomEncoding(body) {
  if (body.length >= 3 && body[0] === 0xef && body[1] === 0xbb && body[2] === 0xbf) return 'utf-8';
  if (body.length >= 2 && body[0] === 0xff && body[1] === 0xfe) return 'utf-16le';
  if (body.length >= 2 && body[0] === 0xfe && body[1] === 0xff) return 'utf-16be';
  return null;
}

/**
 * Charset declared by `<meta charset>` or `<meta http-equiv="Content-Type">`
 * in the first 2048 bytes. Comments are skipped.
 * @param {Buffer} body
 * @returns {string|null}
 */
function metaCharset(body) {
  const head = body.subarray(0, PRESCAN_BYTES).toString('latin1').replace(/<!--[\s\S]*?(-->|$)/g, '');
  const tags = head.match(/<meta\b[^>]*>/gi) ?? [];
  for (const tag of tags) {
    const direct = /\bcharset\s*=\s*["']?\s*([^"'\s/>;]+)/i.exec(tag);
    if (!direct) continue;
    const encoding = encodingFor(direct[1]);
    if (encoding === null) continue;
    // A meta tag cannot declare UTF-16: the bytes it was read from were ASCII-compatible.
    if (encoding.startsWith('utf-16')) return 'utf-8';
    if (encoding === 'x-user-defined') return 'windows-1252';
    return encoding;
  }
  return null;
}

/**
 * Decode an HTML body to text. The encoding comes from the first source that
 * names a known one: a byte order mark, the `Content-Type` charset, a
 * `<meta>` declaration in the first 2048 bytes, and finally UTF-8. Unknown
 * labels are skipped. Invalid byte sequences become U+FFFD; this never throws.
 * @param {Buffer} body
 * @param {string|undefined} contentType
 * @returns {{text: string, encoding: string}}
 */
export function decodeBody(body, contentType) {
  const encoding = bomEncoding(body)
    ?? encodingFor(headerCharset(contentType))
    ?? metaCharset(body)
    ?? 'utf-8';
  return { text: new TextDecoder(encoding).decode(body), encoding };
}
