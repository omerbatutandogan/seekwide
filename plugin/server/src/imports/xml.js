// A small XML reader for the parts of an Excel workbook (Office Open XML,
// ECMA-376): elements with namespace prefixes, attributes in either quote,
// the five predefined entities and character references, comments, CDATA and
// processing instructions. A document type declaration is refused, so no
// entity can be defined and none is ever expanded. No XML dependency.

import { malformed } from './errors.js';

const ENTITIES = /** @type {Record<string, string>} */ ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" });
/** A worksheet nests five or six elements deep; deeper nesting only costs memory. */
const MAX_DEPTH = 32;
/** One tag with its attributes. A workbook's longest tags are a few hundred characters. */
const MAX_TAG_CHARS = 64 * 1024;

/**
 * Text with entities and character references decoded. An unknown entity or a
 * reference to no character makes the part unreadable.
 * @param {string} text
 * @returns {string}
 */
export function decodeXmlText(text) {
  if (!text.includes('&')) return text;
  return text.replace(/&([^;&\s]{0,10});/g, (_, name) => {
    if (name[0] === '#') {
      const code = name[1] === 'x' ? Number.parseInt(name.slice(2), 16) : Number.parseInt(name.slice(1), 10);
      if (!Number.isInteger(code) || code < 1 || code > 0x10ffff) throw malformed('a workbook part holds an invalid character reference');
      return String.fromCodePoint(code);
    }
    if (!Object.hasOwn(ENTITIES, name)) throw malformed('a workbook part uses an entity that XML does not define');
    return ENTITIES[name];
  });
}

/**
 * @param {string} qname
 * @returns {string} The name without its namespace prefix.
 */
function localName(qname) {
  const colon = qname.indexOf(':');
  return colon === -1 ? qname : qname.slice(colon + 1);
}

/**
 * The position of the `>` that ends a tag: the first one outside a quoted
 * attribute value, where XML allows `>` (a number format such as `[>=100]0`).
 * @param {string} xml
 * @param {number} from  Just after the `<`.
 * @returns {number}
 */
function tagEnd(xml, from) {
  const limit = Math.min(xml.length, from + MAX_TAG_CHARS);
  /** @type {string|null} */
  let quote = null;
  for (let i = from; i < limit; i += 1) {
    const char = xml[i];
    if (quote !== null) {
      if (char === quote) quote = null;
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === '>') {
      return i;
    }
  }
  throw malformed(limit === xml.length ? 'a workbook part has an unterminated tag' : 'a workbook part has a tag that is too long');
}

/** @param {string} char */
const isSpace = (char) => char === ' ' || char === '\t' || char === '\n' || char === '\r';

/**
 * The attributes of a tag, read in one pass over its text: name, optional
 * space, `=`, optional space and a value in double or single quotes. A
 * pattern with nested repetition here took seconds on one long tag (review of
 * 2026-11-13), so the text is walked by hand. Names are local names, and
 * `xmlns` declarations are left out. The result has no prototype.
 * @param {string} text  The tag after its name, without the closing `>`.
 * @returns {Record<string, string>}
 */
function parseAttributes(text) {
  /** @type {Record<string, string>} */
  const attributes = Object.create(null);
  const n = text.length;
  let i = 0;
  for (;;) {
    while (i < n && (isSpace(text[i]) || text[i] === '/')) i += 1;
    if (i >= n) return attributes;
    const start = i;
    while (i < n && !isSpace(text[i]) && text[i] !== '=' && text[i] !== '/') i += 1;
    const key = text.slice(start, i);
    while (i < n && isSpace(text[i])) i += 1;
    if (key === '' || text[i] !== '=') throw malformed('a workbook part has an attribute without a value');
    i += 1;
    while (i < n && isSpace(text[i])) i += 1;
    const quote = text[i];
    const end = quote === '"' || quote === "'" ? text.indexOf(quote, i + 1) : -1;
    if (end === -1) throw malformed('a workbook part has an attribute value without quotes');
    const value = text.slice(i + 1, end);
    if (value.includes('<')) throw malformed('a workbook part has an attribute value with "<"');
    if (key !== 'xmlns' && !key.startsWith('xmlns:')) attributes[localName(key)] = decodeXmlText(value);
    i = end + 1;
  }
}

/**
 * @typedef {Object} XmlVisitor
 * @property {(name: string, attributes: Record<string, string>, selfClosing: boolean) => void} [open]
 * @property {(name: string) => void} [close]
 * @property {(text: string) => void} [text]  Text and CDATA inside elements, decoded.
 */

/**
 * Walk an XML document in order, calling the visitor for every element start
 * and end and every run of text. Names are local names (the prefix is
 * dropped); attribute names too, and `xmlns` declarations are left out.
 *
 * Guarantees: a document type declaration, a closing tag that does not match,
 * an element left open, nesting deeper than 32, a tag longer than 64 KiB or an
 * undefined entity throws an `ImportError`. Linear in the length of the text.
 * @param {string} xml
 * @param {XmlVisitor} visitor
 */
export function walkXml(xml, visitor) {
  /** @type {string[]} */
  const stack = [];
  let pos = 0;
  while (pos < xml.length) {
    const lt = xml.indexOf('<', pos);
    const textEnd = lt === -1 ? xml.length : lt;
    if (textEnd > pos && stack.length > 0 && visitor.text) visitor.text(decodeXmlText(xml.slice(pos, textEnd)));
    if (lt === -1) break;
    if (xml.startsWith('<!--', lt)) {
      const end = xml.indexOf('-->', lt + 4);
      if (end === -1) throw malformed('a workbook part has an unterminated comment');
      pos = end + 3;
      continue;
    }
    if (xml.startsWith('<![CDATA[', lt)) {
      const end = xml.indexOf(']]>', lt + 9);
      if (end === -1) throw malformed('a workbook part has an unterminated CDATA section');
      if (stack.length > 0 && visitor.text) visitor.text(xml.slice(lt + 9, end));
      pos = end + 3;
      continue;
    }
    if (xml.startsWith('<!', lt)) throw malformed('a workbook part has a document type declaration, which Seekwide does not read');
    if (xml.startsWith('<?', lt)) {
      const end = xml.indexOf('?>', lt + 2);
      if (end === -1) throw malformed('a workbook part has an unterminated declaration');
      pos = end + 2;
      continue;
    }
    const end = tagEnd(xml, lt + 1);
    const raw = xml.slice(lt + 1, end);
    pos = end + 1;
    if (raw.startsWith('/')) {
      const name = localName(raw.slice(1).trim());
      if (stack.pop() !== name) throw malformed('a workbook part has a closing tag that does not match');
      visitor.close?.(name);
      continue;
    }
    const match = /^[^\s/>]+/.exec(raw);
    if (!match) throw malformed('a workbook part has a malformed tag');
    const name = localName(match[0]);
    const selfClosing = raw.endsWith('/');
    visitor.open?.(name, parseAttributes(raw.slice(match[0].length)), selfClosing);
    if (selfClosing) {
      visitor.close?.(name);
    } else {
      stack.push(name);
      if (stack.length > MAX_DEPTH) throw malformed('a workbook part is nested too deeply');
    }
  }
  if (stack.length > 0) throw malformed('a workbook part ends inside an element');
}
