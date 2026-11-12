// React streaming server rendering (React 18 and later, the Next.js App
// Router): which hidden elements of a served document the page's own inline
// script reveals as soon as it loads, where it puts their content, and which
// fallback content it replaces. Pure, and one walk over the document.
//
// How React streams a page (react-dom's Fizz server): where a Suspense
// boundary waits for data it writes `<!--$?--><template id="B:1"></template>`,
// then the fallback, then `<!--/$-->`. When the content is ready, later in the
// same response, it writes `<div hidden id="S:1">content</div>` and an inline
// script that calls `$RC("B:1","S:1")` (`$RR(...)` when the content waits for
// a style sheet first). That function moves the content of S:1 into the
// boundary, removes the fallback and removes the hidden div. A segment that
// fills a placeholder `<template id="P:2"></template>` is moved there by
// `$RS("S:2","P:2")`. The functions are defined by an inline script before
// their first call.

/** @import { DomNode } from './dom.js' */

import { HTML_NS, attr, isHtmlElement } from './dom.js';

/** Ids longer than this are not React's. */
const MAX_ID_CHARS = 100;
/** Most templates, hidden elements and calls remembered per document; React pages have dozens. */
const MAX_REMEMBERED = 5000;
/** Most sibling nodes looked at, in all, to find the fallbacks of a document's boundaries. */
const MAX_FALLBACK_STEPS = 100_000;
/** The script types a browser runs as a script. */
const JS_TYPE = /^(?:|module|(?:text|application)\/(?:x-)?(?:javascript|ecmascript))$/;
/** A definition of one of React's three functions at the start of a statement: `$RC=function`, or `function $RC(` as React 18.2 wrote it. */
const DEFINITION = /^(?:\$R([CRS])\s*=\s*function\b|function\s+\$R([CRS])\s*\()/;
/** A call with two string ids at the start of a statement, as React writes it; `\0n\0` stands for the n-th string literal. */
const CALL = /^\$R([CRS])\(\0(\d+)\0,\0(\d+)\0[,)]/;
/** Comments that open a Suspense boundary: completed, pending, client-rendered. */
const OPENERS = new Set(['$', '$?', '$!']);
/** The elements that carry a segment's id inside `<table hidden>` in React's table modes. */
const TABLE_SEGMENTS = new Set(['tbody', 'tr', 'colgroup']);
/** Elements whose content a page does not render (fallback content, the head): content moved there is never seen. */
const UNRENDERED = new Set(['head', 'canvas', 'video', 'audio', 'object', 'datalist']);

/**
 * @typedef {Object} StreamedBoundaries
 * @property {Map<DomNode, DomNode>} revealed  Each hidden element (`hidden` attribute) that React's inline script
 *   reveals on load, with the template whose place its content takes.
 * @property {Set<DomNode>} replaced  Nodes of fallback content that the same script removes.
 */

/** @typedef {{fn: string, first: string, second: string, order: number}} Call */

/**
 * @param {DomNode|undefined} node
 * @param {string} text
 * @returns {boolean} True for a comment node with exactly this text.
 */
function isComment(node, text) {
  return node?.nodeName === '#comment' && node.data === text;
}

/**
 * A script's code as a browser parses it, coarsely: comments removed, each
 * string literal replaced by `\0n\0` (its text is `strings[n]`). A regular
 * expression literal is not recognised; a quote inside one only makes the
 * rest of the script unreadable here, which reveals nothing.
 * @param {string} source
 * @returns {{code: string, strings: string[]}}
 */
export function lexScript(source) {
  /** @type {string[]} */
  const strings = [];
  let code = '';
  for (let i = 0; i < source.length;) {
    const char = source[i];
    const next = source[i + 1];
    if (char === '/' && next === '*') {
      const end = source.indexOf('*/', i + 2);
      i = end < 0 ? source.length : end + 2;
      code += ' ';
    } else if (char === '/' && next === '/') {
      const end = source.indexOf('\n', i + 2);
      i = end < 0 ? source.length : end;
    } else if (char === '"' || char === "'" || char === '`') {
      let text = '';
      let j = i + 1;
      while (j < source.length && source[j] !== char) {
        if (source[j] === '\\') j += 1;
        else text += source[j];
        j += 1;
      }
      code += `\0${strings.length}\0`;
      strings.push(text);
      i = j + 1;
    } else {
      code += char;
      i += 1;
    }
  }
  return { code, strings };
}

/**
 * The places in code where a top-level statement starts: the start, and after
 * each `;` outside any bracket. Code inside a block, a function or an
 * expression (`if (x) {…}`, `a && …`) is not a statement start.
 * @param {string} code
 * @returns {number[]}
 */
function statementStarts(code) {
  /** @type {number[]} */
  const starts = [];
  let depth = 0;
  let open = true;
  for (let i = 0; i < code.length; i += 1) {
    const char = code[i];
    if (open && !/\s/.test(char)) {
      starts.push(i);
      open = false;
    }
    if (char === '(' || char === '[' || char === '{') depth += 1;
    else if (char === ')' || char === ']' || char === '}') depth = Math.max(0, depth - 1);
    else if (char === ';' && depth === 0) open = true;
  }
  return starts;
}

/**
 * The calls of React's functions in one inline script, in the order they are
 * written, that are top-level statements after a top-level definition of their
 * function: in an earlier script, or earlier in this one. `defined` carries
 * the definitions seen so far.
 * @param {string} source
 * @param {number} order  The script's place among the document's elements.
 * @param {Map<string, {order: number, at: number}>} defined
 * @param {Call[]} calls
 */
function readScript(source, order, defined, calls) {
  if (!source.includes('$R')) return;
  const { code, strings } = lexScript(source);
  for (const at of statementStarts(code)) {
    if (code[at] !== '$' && code[at] !== 'f') continue;
    const rest = code.slice(at, at + 200);
    const definition = DEFINITION.exec(rest);
    if (definition) {
      const fn = definition[1] ?? definition[2];
      if (!defined.has(fn)) defined.set(fn, { order, at });
      continue;
    }
    const call = CALL.exec(rest);
    if (!call || calls.length >= MAX_REMEMBERED) continue;
    const known = defined.get(call[1]);
    if (!known || (known.order === order && known.at > at)) continue;
    const [first, second] = [strings[Number(call[2])], strings[Number(call[3])]];
    if (first && second && first.length <= MAX_ID_CHARS && second.length <= MAX_ID_CHARS) calls.push({ fn: call[1], first, second, order });
  }
}

/**
 * The element whose `hidden` attribute keeps a streamed segment out of view,
 * when the element with the segment's id is one React writes: `<div hidden>`,
 * or in its table modes `<table hidden>` itself or the `<table hidden>` around
 * a `<tbody>`, `<tr>` (with the `<tbody>` the parser adds) or `<colgroup>`.
 * Null for any other element: React's script moves only a segment's children,
 * so a link that is itself the hidden element is never shown.
 * @param {DomNode} node  An HTML element with an id.
 * @returns {DomNode|null}
 */
function segmentOf(node) {
  if ((node.tagName === 'div' || node.tagName === 'table') && attr(node, 'hidden') !== null) return node;
  if (!TABLE_SEGMENTS.has(node.tagName ?? '')) return null;
  let table = node.parentNode;
  if (node.tagName === 'tr' && table && isHtmlElement(table, 'tbody')) table = table.parentNode;
  return table && isHtmlElement(table, 'table') && attr(table, 'hidden') !== null ? table : null;
}

/**
 * The fallback of a pending boundary: the siblings after its template up to
 * the comment that closes the boundary, nested boundaries counted. Null when
 * the template does not follow `<!--$?-->`, the boundary is never closed, or
 * the document's budget of steps is spent.
 * @param {DomNode} template
 * @param {{steps: number}} budget
 * @returns {DomNode[]|null}
 */
function fallbackOf(template, budget) {
  const siblings = template.parentNode?.childNodes ?? [];
  const at = siblings.indexOf(template);
  if (at < 1 || !isComment(siblings[at - 1], '$?')) return null;
  let depth = 0;
  for (let i = at + 1; i < siblings.length; i += 1) {
    budget.steps -= 1;
    if (budget.steps < 0) return null;
    const node = siblings[i];
    if (node.nodeName !== '#comment') continue;
    if (OPENERS.has(node.data ?? '')) depth += 1;
    else if (node.data === '/$') {
      if (depth === 0) return siblings.slice(at + 1, i);
      depth -= 1;
    }
  }
  return null;
}

/**
 * Find React's streamed boundaries in a parsed document.
 *
 * A hidden element counts as revealed when all of this holds, as React writes
 * it: it is a segment of React's shape (`segmentOf`); an empty `<template>`
 * with the other id of the call comes before it in the document, in a place
 * the page renders (not in `<head>` or in the fallback content of a
 * `<video>`, `<canvas>` and the like); and after it an inline
 * script of a JavaScript type, not `nomodule`, has as a top-level statement a
 * call of `$RC` or `$RR` (the template's id, then the element's) or `$RS` (the
 * element's id, then the template's), with that function defined by a
 * top-level statement of an inline script before the call. Comments and the
 * insides of string literals do not count. For `$RC` and `$RR` the template
 * must also follow a `<!--$?-->` comment and the boundary must be closed by
 * `<!--/$-->`; the nodes in between are the fallback the call replaces. When
 * ids repeat, the first element with the id counts, as for `getElementById`,
 * whatever its namespace (an earlier SVG element takes the id).
 * @param {DomNode} document
 * @returns {StreamedBoundaries}
 */
export function streamedBoundaries(document) {
  /** @type {Map<string, {node: DomNode, order: number}>} */
  const templates = new Map();
  /** @type {Map<string, {node: DomNode, order: number}>} */
  const hidden = new Map();
  /** @type {Map<string, {order: number, at: number}>} */
  const defined = new Map();
  /** @type {Call[]} */
  const calls = [];
  /** Every id seen, for the first-element rule; bounded by the parsed tags of a page. @type {Set<string>} */
  const seen = new Set();
  let order = 0;
  /** Each node with whether it is inside an element whose content is not rendered. @type {{node: DomNode, unrendered: boolean}[]} */
  const stack = [{ node: document, unrendered: false }];
  while (stack.length > 0) {
    const { node, unrendered } = /** @type {{node: DomNode, unrendered: boolean}} */ (stack.pop());
    let inside = unrendered;
    if (node.tagName) {
      const id = attr(node, 'id');
      const first = id !== null && id !== '' && id.length <= MAX_ID_CHARS && !seen.has(id);
      if (first) seen.add(/** @type {string} */ (id));
      if (node.namespaceURI === HTML_NS) {
        order += 1;
        inside = unrendered || UNRENDERED.has(node.tagName);
        if (first && node.tagName === 'template') {
          if (!unrendered && (node.content?.childNodes ?? []).length === 0 && templates.size < MAX_REMEMBERED) templates.set(/** @type {string} */ (id), { node, order });
        } else if (first) {
          const segment = segmentOf(node);
          if (segment !== null && hidden.size < MAX_REMEMBERED) hidden.set(/** @type {string} */ (id), { node: segment, order });
        }
        const type = (attr(node, 'type') ?? '').split(';', 1)[0].trim().toLowerCase();
        if (isHtmlElement(node, 'script') && attr(node, 'src') === null && attr(node, 'nomodule') === null && JS_TYPE.test(type)) {
          readScript((node.childNodes ?? []).map((child) => child.value ?? '').join(''), order, defined, calls);
        }
      }
    }
    const children = node.childNodes ?? [];
    for (let i = children.length - 1; i >= 0; i -= 1) stack.push({ node: children[i], unrendered: inside });
  }

  /** @type {StreamedBoundaries} */
  const found = { revealed: new Map(), replaced: new Set() };
  const budget = { steps: MAX_FALLBACK_STEPS };
  for (const call of calls) {
    const [segmentId, templateId] = call.fn === 'S' ? [call.first, call.second] : [call.second, call.first];
    const segment = hidden.get(segmentId);
    const template = templates.get(templateId);
    if (!segment || !template || found.revealed.has(segment.node) || !(template.order < segment.order && segment.order < call.order)) continue;
    if (call.fn === 'S') {
      found.revealed.set(segment.node, template.node);
      continue;
    }
    const fallback = fallbackOf(template.node, budget);
    if (fallback === null) continue;
    found.revealed.set(segment.node, template.node);
    for (const node of fallback) found.replaced.add(node);
  }
  return found;
}
