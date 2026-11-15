// What the markup around a form control says (cro module, rule set 0.2.1):
// whether an element hides itself, whether a label or a referenced element
// gives a name, the form and label around a control, and whether a form is a
// search form. Pure; used by forms.js while the document is walked.

/** @import { DomNode } from './dom.js' */
/** @import { FormsState } from './forms.js' */

import { offscreen, parseStyle } from './concealment.js';
import { attr, isAriaHidden, textOf } from './dom.js';

/** Elements looked at above a control; a control deeper than this is not judged. */
export const MAX_ANCESTORS = 200;
const MAX_LABEL_NODES = 500;
/** Elements whose text is not the text of a label around a control. */
const NOT_LABEL_TEXT = new Set(['script', 'style', 'template', 'noscript', 'select', 'textarea', 'datalist', 'option', 'optgroup']);
/** Elements a label can label (HTML: labelable elements; an input of type hidden is not one). */
const LABELABLE = new Set(['button', 'input', 'meter', 'output', 'progress', 'select', 'textarea']);

/** @param {string|null} value */
export const filled = (value) => value !== null && value.trim() !== '';

/** @param {DomNode} node */
export const roleOf = (node) => (attr(node, 'role') ?? '').trim().toLowerCase().split(/\s+/, 1)[0];

/**
 * True when the element's own markup takes it and its content out of what assistive technology reads: the `hidden`
 * attribute (not `until-found`), `aria-hidden="true"`, or an inline `display: none` or `visibility: hidden`. Text moved
 * off-screen is still read (the usual way to label for screen readers only).
 * @param {DomNode} node @param {Map<string, string>} [style]
 */
function silent(node, style = parseStyle(attr(node, 'style'))) {
  const hidden = attr(node, 'hidden');
  return (hidden !== null && hidden.trim().toLowerCase() !== 'until-found') || isAriaHidden(node)
    || style.get('display') === 'none' || ['hidden', 'collapse'].includes(style.get('visibility') ?? '');
}

/**
 * True when the element's own markup hides it and its content from visitors: what `silent` names, or an inline
 * off-screen position.
 * @param {DomNode} node @param {FormsState} state
 */
export function hidesItself(node, state) {
  const known = state.ownHidden.get(node);
  if (known !== undefined) return known;
  const style = parseStyle(attr(node, 'style'));
  const result = silent(node, style) || offscreen(style);
  state.ownHidden.set(node, result);
  return result;
}

/**
 * True for an element a label can label.
 * @param {DomNode} node
 */
export function isLabelable(node) {
  const tag = node.tagName ?? '';
  return LABELABLE.has(tag) && !(tag === 'input' && (attr(node, 'type') ?? '').trim().toLowerCase() === 'hidden');
}

/**
 * Whether a label gives a name of its own, as accessible name computation reads a label: its own `aria-label`, a text
 * node with something other than spaces, an image with an `alt`, or an element with an `aria-label` (an icon), outside
 * the controls it holds and outside what its markup takes out of the accessibility tree (`silent`).
 * @param {DomNode} label
 */
export function labelHasText(label) {
  if (filled(attr(label, 'aria-label'))) return true;
  // In document order, so that the label's own first text is found at once even when labels are nested deeply.
  /** @type {DomNode[]} */
  const stack = [...(label.childNodes ?? [])].reverse();
  for (let budget = MAX_LABEL_NODES; stack.length > 0 && budget > 0; budget -= 1) {
    const node = /** @type {DomNode} */ (stack.pop());
    if (node.nodeName === '#text') {
      if ((node.value ?? '').trim() !== '') return true;
      continue;
    }
    if (!node.tagName || NOT_LABEL_TEXT.has(node.tagName) || silent(node)) continue;
    if (node.tagName === 'img' && filled(attr(node, 'alt'))) return true;
    if (filled(attr(node, 'aria-label'))) return true;
    const children = node.childNodes ?? [];
    for (let i = children.length - 1; i >= 0; i -= 1) stack.push(children[i]);
  }
  return false;
}

/**
 * Whether an element that `aria-labelledby` names gives a name: its own `aria-label` or `title`, its `alt` when it is
 * an image, or text (with the `alt` of contained images and contained `aria-label`s; an SVG `<title>` gives its text).
 * Answered once per element (`state.namesGiven`): any number of controls may name the same large element.
 * @param {DomNode} node @param {FormsState} state
 */
export function givesName(node, state) {
  const known = state.namesGiven.get(node);
  if (known !== undefined) return known;
  const result = filled(attr(node, 'aria-label')) || filled(attr(node, 'title')) || (node.tagName === 'img' && filled(attr(node, 'alt')))
    || textOf(node, true, 100, true).trim() !== '';
  state.namesGiven.set(node, result);
  return result;
}

/**
 * Remember, for every label around a labelable element, the first labelable element it holds: only that one is
 * labelled by it (HTML). Called for every labelable element in document order.
 * @param {DomNode} node @param {FormsState} state
 */
export function markLabelable(node, state) {
  let parent = node.parentNode ?? null;
  for (let depth = 0; parent && parent.tagName && depth < MAX_ANCESTORS; depth += 1) {
    if (parent.tagName === 'label' && !state.labelFirst.has(parent)) state.labelFirst.set(parent, node);
    parent = parent.parentNode ?? null;
  }
}

/**
 * What the elements around a control say about it: whether one hides it, the form it is in, whether a label around it
 * names it, and whether every element above it was looked at (`complete`; when not, the control is not judged).
 * A label around it (any of them, when labels are nested) names it when the label has text and either has a non-empty
 * `for` that is exactly the control's id, or has no `for` attribute at all and the control is its first labelable
 * element; a `for` attribute, even empty, means the label does not label what it wraps unless it names it.
 * @param {DomNode} node @param {FormsState} state @param {string|null} rawId  The control's `id` as written.
 */
export function surroundings(node, state, rawId) {
  let hidden = hidesItself(node, state);
  /** @type {number|null} */
  let form = null;
  let wrapped = false;
  let parent = node.parentNode ?? null;
  let depth = 0;
  for (; parent && parent.tagName && depth < MAX_ANCESTORS; depth += 1) {
    if (!hidden && hidesItself(parent, state)) hidden = true;
    if (form === null && state.formIndex.has(parent)) form = /** @type {number} */ (state.formIndex.get(parent));
    if (!wrapped && parent.tagName === 'label') {
      const target = attr(parent, 'for');
      wrapped = state.labelText.get(parent) === true && (target !== null ? target !== '' && target === rawId : state.labelFirst.get(parent) === node);
    }
    parent = parent.parentNode ?? null;
  }
  return { hidden, form, wrapped, complete: !(parent && parent.tagName) };
}

/**
 * True when `ancestor` is an element around `node`.
 * @param {DomNode} node @param {DomNode} ancestor
 */
export function isInside(node, ancestor) {
  let parent = node.parentNode ?? null;
  for (let depth = 0; parent && depth < MAX_ANCESTORS; depth += 1) {
    if (parent === ancestor) return true;
    parent = parent.parentNode ?? null;
  }
  return false;
}

/** @param {DomNode} form @param {DomNode} node */
export function isSearchForm(form, node) {
  if (roleOf(form) === 'search') return true;
  let parent = node.parentNode ?? null;
  for (let depth = 0; parent && parent.tagName && depth < MAX_ANCESTORS; depth += 1) {
    if (parent.tagName === 'search' || roleOf(parent) === 'search') return true;
    parent = parent.parentNode ?? null;
  }
  return false;
}
