// Which hidden elements a visitor can open: an element that a control on the
// page names by id, comes right after, or shows through the script of the
// component around it. Used by the security scan to tell a closed menu from
// content hidden for good. Pure.

/** @import { DomNode } from './dom.js' */

import { HTML_NS, attr, isHtmlElement } from './dom.js';

/** Most ids collected from the `data-*` attributes of a page's controls. */
export const MAX_REFERENCES = 20_000;

/** Attributes of a control whose value names, by id, the element it opens or describes. */
const ID_ATTRIBUTES = ['aria-controls', 'popovertarget', 'commandfor', 'aria-describedby'];
/** `data-*` attributes that script libraries use to name, by `#id` or id, the element a control opens. */
const DATA_TARGETS = new Set([
  'data-target', 'data-bs-target', 'data-toggle-target', 'data-tab', 'data-tab-target', 'data-modal', 'data-modal-target',
  'data-popup', 'data-open', 'data-reveal-id', 'data-micromodal-trigger', 'data-controls', 'data-panel', 'data-fancybox-src',
]);
/** `data-*` attributes that name an element only with `#` (fancybox's `data-src`; lazy loading puts a file there). */
const DATA_TARGETS_HASH = new Set(['data-src']);
/** An event binding of Alpine.js or Vue: `@click`, `x-on:click.prevent`, `v-on:keydown`. */
const EVENT_BINDING = /^(?:@|x-on:|v-on:)/;
/** Elements a visitor can act on. */
const CONTROL_TAGS = new Set(['button', 'summary', 'input', 'select']);
const CONTROL_ROLES = new Set(['button', 'menuitem', 'tab', 'combobox', 'switch', 'link']);
/** Most children of the element before a hidden one looked at for a control (a button wrapped in a box). */
const MAX_WRAPPED = 20;

/**
 * What the page's controls and scripts say, read from the whole page before the scan.
 * @typedef {Object} References
 * @property {Set<string>} ids        Ids a control names (`ID_ATTRIBUTES` and `href="#id"` on a control, `DATA_TARGETS`
 *   on any element), from outside the element with that id.
 * @property {Set<string>} tabs       Ids of elements with the role `tab`.
 * @property {Map<DomNode, number>} bindings  For each element with `x-data`, `x-show` or `v-show`, and the document, how many
 *   event bindings it and the elements inside it carry.
 * @property {Map<DomNode, DomNode>} scopes   For each element with `x-show`, the nearest element with `x-data` around it or on it.
 * @property {DomNode|null} root      The document.
 * @property {boolean} capped         Some `data-*` ids were left out at `MAX_REFERENCES`.
 */

/**
 * True for an element a visitor can act on: a button, a summary, a form
 * field, a link with an address, an element with a control's role, or one
 * that takes the keyboard focus.
 * @param {DomNode} node
 */
function isControl(node) {
  if (node.namespaceURI !== HTML_NS) return false;
  if (CONTROL_TAGS.has(node.tagName ?? '')) return true;
  if (isHtmlElement(node, 'a') && attr(node, 'href') !== null) return true;
  return CONTROL_ROLES.has((attr(node, 'role') ?? '').trim().toLowerCase()) || attr(node, 'tabindex') !== null;
}

/**
 * True for an element its own markup hides (`hidden`, `display: none`): a
 * control like that cannot be used.
 * @param {DomNode} node
 */
function hidesItself(node) {
  return attr(node, 'hidden') !== null || /display\s*:\s*none/i.test(attr(node, 'style') ?? '');
}

/**
 * True for a control that says with `aria-expanded` or `aria-haspopup` that it opens something.
 * @param {DomNode} node
 */
function disclosure(node) {
  return isControl(node) && (attr(node, 'aria-expanded') !== null || attr(node, 'aria-haspopup') !== null);
}

/**
 * True for a hidden element that a control on the page opens, as the markup
 * tells: it comes right after a `<summary>`, or right after a control that
 * says with `aria-expanded` or `aria-haspopup` that it opens something (or an
 * element that holds such a control); it is a tab panel labelled by a tab;
 * or the script of the component around it shows it: an `x-show` inside an
 * Alpine.js component (`x-data`) whose other elements carry an event
 * binding, or a `v-show` on a page with an event binding elsewhere. An
 * element named by id by a control is openable too; the scan checks that
 * apart (`References.ids`). A role (dialog, menu) or an attribute
 * (`popover`, `aria-modal`, `x-cloak`) alone is not enough: anyone who writes
 * the markup can add one, and a dialog or popover that a visitor opens has a
 * control that names it.
 * @param {DomNode} node
 * @param {DomNode|null} previous  The element right before it among its siblings.
 * @param {References} references
 * @returns {boolean}
 */
export function openable(node, previous, references) {
  const count = (/** @type {DomNode|null|undefined} */ element) => (element ? references.bindings.get(element) ?? 0 : 0);
  const scope = references.scopes.get(node);
  if (attr(node, 'x-show') !== null && scope && scope !== node && count(scope) > count(node)) return true;
  if (attr(node, 'v-show') !== null && count(references.root) > count(node)) return true;
  if ((attr(node, 'role') ?? '').trim().toLowerCase() === 'tabpanel'
    && (attr(node, 'aria-labelledby') ?? '').split(/\s+/).some((id) => references.tabs.has(id))) return true;
  if (!previous || previous.namespaceURI !== HTML_NS) return false;
  if (isHtmlElement(previous, 'summary') || disclosure(previous)) return true;
  const children = (previous.childNodes ?? []).filter((child) => child.tagName).slice(0, MAX_WRAPPED);
  return children.some(disclosure);
}

/**
 * The ids an element names, as a control (`ID_ATTRIBUTES`, `href="#id"` on
 * a link) or through a script library's `data-*` attribute (`DATA_TARGETS`,
 * with or without `#`). An element that is no control names nothing through
 * the first, and one hidden by its own markup names nothing at all.
 * @param {DomNode} node
 * @returns {{ids: string[], data: string[]}}
 */
function referencedIds(node) {
  /** @type {string[]} */
  const ids = [];
  /** @type {string[]} */
  const data = [];
  if (hidesItself(node)) return { ids, data };
  const control = isControl(node);
  const link = isHtmlElement(node, 'a') || isHtmlElement(node, 'area');
  for (const { name, value } of node.attrs ?? []) {
    const trimmed = value.trim();
    if (trimmed === '' || trimmed.length > 200) continue;
    if (ID_ATTRIBUTES.includes(name)) {
      if (control) ids.push(...trimmed.split(/\s+/));
    } else if (name === 'href' && link && trimmed.startsWith('#')) ids.push(trimmed.slice(1));
    else if (DATA_TARGETS.has(name)) data.push(trimmed.startsWith('#') ? trimmed.slice(1) : trimmed);
    else if (DATA_TARGETS_HASH.has(name) && trimmed.startsWith('#')) data.push(trimmed.slice(1));
  }
  return { ids, data };
}

/**
 * What the page's controls name and what its components bind, read from
 * the whole page before the scan, so that a control after the element it
 * opens counts as much as one before it. An element cannot open itself: an
 * id named by the element that has it, or by an element inside that one,
 * does not count. The HTML elements are visited as the scan visits them,
 * with the content of declarative shadow roots.
 * @param {DomNode} document  A parse5 document.
 * @returns {References}
 */
export function collectReferences(document) {
  /** @type {References} */
  const references = { ids: new Set(), tabs: new Set(), bindings: new Map(), scopes: new Map(), root: document, capped: false };
  /** Ids of the open elements around the current one, with how many have each. @type {Map<string, number>} */
  const around = new Map();
  /** Open elements with `x-data`, innermost last. @type {DomNode[]} */
  const components = [];
  let seen = 0;
  /** The binding count when each counted element was entered. @type {Map<DomNode, number>} */
  const entered = new Map([[document, 0]]);
  /** @type {{node: DomNode, exit: boolean}[]} */
  const stack = [{ node: document, exit: false }];
  while (stack.length > 0) {
    const { node, exit } = /** @type {{node: DomNode, exit: boolean}} */ (stack.pop());
    const html = Boolean(node.tagName) && node.namespaceURI === HTML_NS;
    const id = html ? attr(node, 'id')?.trim() || null : null;
    if (exit) {
      if (id !== null) around.set(id, (around.get(id) ?? 1) - 1);
      if (components.at(-1) === node) components.pop();
      const start = entered.get(node);
      if (start !== undefined) references.bindings.set(node, seen - start);
      continue;
    }
    if (html) {
      if (id !== null) around.set(id, (around.get(id) ?? 0) + 1);
      if (attr(node, 'x-data') !== null || attr(node, 'x-show') !== null || attr(node, 'v-show') !== null) entered.set(node, seen);
      if (attr(node, 'x-data') !== null) components.push(node);
      if (attr(node, 'x-show') !== null) references.scopes.set(node, components.at(-1) ?? node);
      if ((attr(node, 'role') ?? '').trim().toLowerCase() === 'tab' && id !== null) references.tabs.add(id);
      const named = referencedIds(node);
      const outside = (/** @type {string} */ target) => (around.get(target) ?? 0) === 0;
      for (const target of named.ids) if (outside(target)) references.ids.add(target);
      for (const target of named.data) {
        if (!outside(target)) continue;
        if (references.ids.size < MAX_REFERENCES) references.ids.add(target);
        else references.capped = true;
      }
      for (const { name } of node.attrs ?? []) if (EVENT_BINDING.test(name)) seen += 1;
    }
    stack.push({ node, exit: true });
    const children = [...(node.childNodes ?? []), ...shadowContent(node)];
    for (let i = children.length - 1; i >= 0; i -= 1) stack.push({ node: children[i], exit: false });
  }
  references.bindings.set(document, seen);
  return references;
}

/**
 * The nodes of a declarative shadow root (`<template shadowrootmode>`), which
 * a browser shows inside the element around the template; none for any
 * other node.
 * @param {DomNode} node
 * @returns {DomNode[]}
 */
export function shadowContent(node) {
  if (!isHtmlElement(node, 'template') || (attr(node, 'shadowrootmode') === null && attr(node, 'shadowroot') === null)) return [];
  return /** @type {{content?: DomNode}} */ (node).content?.childNodes ?? [];
}
