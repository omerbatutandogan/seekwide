// A small, tolerant scanner for XML sitemaps. It understands just enough XML
// (elements, comments, CDATA, processing instructions, doctype, entities and
// namespace prefixes) to pull out <loc> values. No XML dependency.

const ENTITIES = /** @type {Record<string, string>} */ ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" });

/**
 * @param {string} text
 * @returns {string}
 */
function decodeEntities(text) {
  return text.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, (match, name) => {
    if (name[0] === '#') {
      const code = name[1] === 'x' || name[1] === 'X' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
      return code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
    }
    return ENTITIES[name] ?? match;
  });
}

/**
 * @param {string} qname
 * @returns {{prefix: string, local: string}}
 */
function splitName(qname) {
  const colon = qname.indexOf(':');
  return colon === -1 ? { prefix: '', local: qname } : { prefix: qname.slice(0, colon), local: qname.slice(colon + 1) };
}

/**
 * @typedef {Object} ScanResult
 * @property {'urlset'|'index'|null} type  null when the document is not a sitemap.
 * @property {string[]} locs               Raw `loc` values in document order (entities decoded, trimmed).
 * @property {string|null} error           Why the document is not a valid sitemap.
 */

/**
 * Scan a sitemap document.
 *
 * Guarantees: `type` is 'urlset' or 'index' only when the root element is
 * `urlset` or `sitemapindex`; `locs` then holds the text of every `loc` that is
 * a direct child of a `url` (or `sitemap`) element under the root, with the
 * same namespace prefix as the root. Other `loc` elements such as `image:loc`
 * are ignored. When `partial` is true the document may end mid-way and unclosed
 * elements are not an error.
 *
 * @param {string} xml
 * @param {{partial?: boolean}} [options]
 * @returns {ScanResult}
 */
export function scanSitemap(xml, { partial = false } = {}) {
  /** @type {{prefix: string, local: string}[]} */
  const stack = [];
  /** @type {string[]} */
  const locs = [];
  /** @type {'urlset'|'index'|null} */
  let type = null;
  let rootPrefix = '';
  let rootSeen = false;
  /** @type {string[]|null} */
  let capture = null;
  let pos = 0;

  /** @param {string} message */
  const invalid = (message) => ({ type: null, locs: [], error: message });

  while (pos < xml.length) {
    const lt = xml.indexOf('<', pos);
    const textEnd = lt === -1 ? xml.length : lt;
    if (textEnd > pos) {
      const text = xml.slice(pos, textEnd);
      if (capture) capture.push(decodeEntities(text));
      else if (stack.length === 0 && text.trim() !== '') {
        return invalid(rootSeen ? 'content after the root element' : 'not an XML document');
      }
    }
    if (lt === -1) break;

    if (xml.startsWith('<!--', lt)) {
      const end = xml.indexOf('-->', lt + 4);
      if (end === -1) return partial ? { type, locs, error: null } : invalid('unterminated comment');
      pos = end + 3;
      continue;
    }
    if (xml.startsWith('<![CDATA[', lt)) {
      const end = xml.indexOf(']]>', lt + 9);
      if (end === -1) return partial ? { type, locs, error: null } : invalid('unterminated CDATA section');
      if (capture) capture.push(xml.slice(lt + 9, end));
      pos = end + 3;
      continue;
    }
    if (xml.startsWith('<?', lt) || xml.startsWith('<!', lt)) {
      const end = xml.indexOf('>', lt + 2);
      if (end === -1) return partial ? { type, locs, error: null } : invalid('unterminated declaration');
      pos = end + 1;
      continue;
    }

    const end = xml.indexOf('>', lt + 1);
    if (end === -1) return partial ? { type, locs, error: null } : invalid('unterminated tag');
    const raw = xml.slice(lt + 1, end);
    pos = end + 1;

    if (raw.startsWith('/')) {
      const name = splitName(raw.slice(1).trim());
      const top = stack.pop();
      if (!top || top.prefix !== name.prefix || top.local !== name.local) {
        return invalid(`mismatched closing tag </${raw.slice(1).trim()}>`);
      }
      if (capture && name.local === 'loc' && stack.length === 2) {
        locs.push(capture.join('').trim());
        capture = null;
      }
      continue;
    }

    const match = /^([A-Za-z_][\w.-]*(?::[A-Za-z_][\w.-]*)?)/.exec(raw);
    if (!match) return invalid('malformed tag');
    const name = splitName(match[1]);
    const selfClosing = raw.endsWith('/');

    if (!rootSeen) {
      rootSeen = true;
      rootPrefix = name.prefix;
      if (name.local === 'urlset') type = 'urlset';
      else if (name.local === 'sitemapindex') type = 'index';
      else return invalid(`root element <${match[1]}> is not urlset or sitemapindex`);
    } else if (stack.length === 0) {
      return invalid('more than one root element');
    }

    if (selfClosing) continue;
    const entryName = type === 'urlset' ? 'url' : 'sitemap';
    if (
      stack.length === 2 && name.local === 'loc' && name.prefix === rootPrefix &&
      stack[1].local === entryName && stack[1].prefix === rootPrefix
    ) {
      capture = [];
    }
    stack.push(name);
  }

  if (!rootSeen) return invalid('empty document');
  if (stack.length > 0 && !partial) return invalid(`unclosed element <${stack[stack.length - 1].local}>`);
  return { type, locs, error: null };
}
