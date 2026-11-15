// What the cro module reads from a page (rule set 0.2.1): its forms, the visible
// controls with the source of their accessible name, the IAB TCF consent API
// stub and the first action element. Pure; html.js walks the document and calls
// these for every element. Only the markup is read: nothing is ever typed into
// a form, no form is submitted and no action URL is requested.

/** @import { ControlRecord, FirstAction, FormRecord, FormsRecord, NameSource } from '../types.js' */
/** @import { DomNode } from './dom.js' */
/** @import { Frame } from './html-elements.js' */

import { clip, collapseWhitespace } from '../util/strings.js';
import { normalizeUrl } from '../util/url.js';
import { attr, lineOf } from './dom.js';
import { isValidAutocomplete } from '../util/autofill.js';
import { filled, givesName, isInside, isLabelable, isSearchForm, labelHasText, markLabelable, roleOf, surroundings } from './form-markup.js';

export const MAX_FORMS = 50;
export const MAX_CONTROLS = 200;
/** Controls looked at, hidden ones included; the rest of a page's controls are not read. */
export const MAX_SEEN_CONTROLS = 2000;
/** Element ids remembered per page (the first element of each); a name past this is not judged. */
export const MAX_IDS = 20_000;
const SHORT = 100;
/** Only the start of an inline script is searched for the consent API's name. */
const SCRIPT_PREFIX = 65_536;
/** Input types that are not filled in by the visitor. */
const NOT_FILLED = new Set(['hidden', 'submit', 'reset', 'button', 'image']);
const ACTION_INPUTS = new Set(['submit', 'button', 'image']);
/** Framework bindings whose value, set by a script, names the control (as `:alt` gives an image its text, media module). */
const NAME_BINDINGS = [':aria-label', 'v-bind:aria-label', 'x-bind:aria-label', '[aria-label]', '[attr.aria-label]',
  ':aria-labelledby', 'v-bind:aria-labelledby', '[attr.aria-labelledby]', ':title', 'v-bind:title', 'x-bind:title', '[title]', '[attr.title]'];
const PLACEHOLDER_BINDINGS = [':placeholder', 'v-bind:placeholder', 'x-bind:placeholder', '[placeholder]', '[attr.placeholder]'];

/**
 * A visible control while the page is read; its name sources are resolved once
 * every label and id of the page is known.
 * @typedef {Object} PendingControl
 * @property {DomNode} node
 * @property {ControlRecord} record
 * @property {string|null} rawId      Its `id` exactly as written: ids, `for` and `form` match exactly, never trimmed or clipped.
 * @property {number|null} form       The form around it.
 * @property {string|null} formAttr   Its `form` attribute as written, which names a form by id and wins over the form around it.
 * @property {string[]} labelledby
 * @property {Exclude<NameSource, 'labelledby'|'label'|'wrapping_label'|'unknown'>|null} own  The source its own attributes give.
 * @property {boolean} wrapped        A label around it names it.
 */

/**
 * @typedef {Object} FormsState
 * @property {string} baseUrl
 * @property {FormRecord[]} forms
 * @property {WeakMap<DomNode, number>} formIndex
 * @property {Map<string, number>} formIds
 * @property {PendingControl[]} pending
 * @property {Map<string, DomNode>} firstById  The first element with each id, up to `MAX_IDS` ids (the one a label or
 *   `aria-labelledby` names).
 * @property {boolean} idsFull         More ids than `MAX_IDS`: a name an unremembered id gives is not known.
 * @property {Set<string>} labelFor   `for` values, as written, of labels that give a name.
 * @property {WeakMap<DomNode, boolean>} labelText  Whether each label gives a name of its own.
 * @property {WeakMap<DomNode, DomNode>} labelFirst  The first labelable element of each label, the only one it labels.
 * @property {WeakMap<DomNode, boolean>} namesGiven  Whether each element `aria-labelledby` names gives a name, answered once.
 * @property {WeakMap<DomNode, boolean>} ownHidden  Whether each element looked at hides itself and its content.
 * @property {number} seen
 * @property {number} hidden
 * @property {number} unjudged         Controls not judged because the elements above them could not all be read.
 * @property {number} unread           Controls past the `MAX_SEEN_CONTROLS` looked at.
 * @property {boolean} tcf
 * @property {number} elements        Elements of the body read so far.
 * @property {{node: DomNode, elements: number, text: number}|null} main  Where the first main element starts.
 * @property {{inMain: boolean, tag: 'button'|'input', elements: number, text: number, line: number|null}|null} action
 * @property {Set<string>} limits
 * @property {boolean} failed
 */

/**
 * @param {string} baseUrl  The page's base URL, for the forms' action.
 * @returns {FormsState}
 */
export function formsState(baseUrl) {
  return {
    baseUrl, forms: [], formIndex: new WeakMap(), formIds: new Map(), pending: [], firstById: new Map(), idsFull: false, labelFor: new Set(),
    labelText: new WeakMap(), labelFirst: new WeakMap(), namesGiven: new WeakMap(), ownHidden: new WeakMap(), seen: 0, hidden: 0, unjudged: 0, unread: 0, tcf: false, elements: 0, main: null, action: null,
    limits: new Set(), failed: false,
  };
}

/** @returns {FormsRecord} The record of a page without HTML content. */
export function emptyForms() {
  return { forms: [], controls: [], hidden_controls: 0, tcf_stub: false, first_action: null };
}

/** @param {string|null} value @returns {string|null} */
const short = (value) => {
  const trimmed = collapseWhitespace(value ?? '');
  return trimmed === '' ? null : clip(trimmed, SHORT);
};

/**
 * @param {DomNode} node @param {Frame} frame @param {FormsState} state @param {'button'|'input'} tag @param {number} textAt
 */
function actionElement(node, frame, state, tag, textAt) {
  if (!frame.body || state.action?.inMain) return;
  const inMain = state.main !== null && isInside(node, state.main.node);
  if (state.action !== null && !inMain) return;
  state.action = { inMain, tag, elements: state.elements - 1, text: textAt, line: lineOf(node) };
}

/** @param {DomNode} node @param {FormsState} state */
function readForm(node, state) {
  if (state.forms.length >= MAX_FORMS) {
    state.limits.add('forms');
    return;
  }
  const index = state.forms.length;
  const rawId = attr(node, 'id');
  const raw = attr(node, 'action');
  state.formIndex.set(node, index);
  if (rawId !== null && rawId !== '' && !state.formIds.has(rawId)) state.formIds.set(rawId, index);
  state.forms.push({
    line: lineOf(node), id: short(rawId), name: short(attr(node, 'name')),
    action: filled(raw) ? normalizeUrl(/** @type {string} */ (raw).trim(), state.baseUrl) : null,
    method: clip((attr(node, 'method') ?? '').trim().toLowerCase() || 'get', 20), search: isSearchForm(node, node), fields: 0,
  });
}

/**
 * @param {DomNode} node @param {'input'|'select'|'textarea'} tag @param {string} type @param {FormsState} state
 */
function readControl(node, tag, type, state) {
  if (state.seen >= MAX_SEEN_CONTROLS) {
    state.limits.add('forms.controls');
    state.unread += 1;
    return;
  }
  state.seen += 1;
  const rawId = attr(node, 'id');
  const { hidden, form, wrapped, complete } = surroundings(node, state, rawId);
  if (!complete) {
    // An element above it that was not looked at could hide it: not judged rather than judged visible.
    state.unjudged += 1;
    state.limits.add('forms.depth');
    return;
  }
  if (hidden) {
    state.hidden += 1;
    return;
  }
  const own = filled(attr(node, 'aria-label')) ? 'aria_label'
    : filled(attr(node, 'title')) ? 'title'
      : NAME_BINDINGS.some((name) => attr(node, name) !== null) ? 'binding'
        : filled(attr(node, 'placeholder')) || PLACEHOLDER_BINDINGS.some((name) => attr(node, name) !== null) ? 'placeholder' : null;
  const autocomplete = attr(node, 'autocomplete');
  state.pending.push({
    node,
    record: {
      form: null, tag, type: clip(type, 30), name: short(attr(node, 'name')), id: short(rawId),
      autocomplete: autocomplete === null ? null : clip(collapseWhitespace(autocomplete), SHORT),
      autocomplete_valid: autocomplete === null ? null : isValidAutocomplete(autocomplete), named_by: 'none',
      paste_blocked: tag !== 'select' && /return\s*false|preventdefault/i.test(attr(node, 'onpaste') ?? ''), line: lineOf(node),
    },
    rawId, form, formAttr: attr(node, 'form'), labelledby: (attr(node, 'aria-labelledby') ?? '').split(/[\t\n\f\r ]+/).filter(Boolean).slice(0, 10),
    own: /** @type {PendingControl['own']} */ (own), wrapped,
  });
}

/**
 * @param {DomNode} node @param {Frame} frame @param {FormsState} state @param {number} textAt
 */
function read(node, frame, state, textAt) {
  const tag = /** @type {string} */ (node.tagName);
  if (frame.body) state.elements += 1;
  const id = attr(node, 'id');
  if (id !== null && id !== '' && !state.firstById.has(id)) {
    if (state.firstById.size < MAX_IDS) state.firstById.set(id, node);
    else state.idsFull = true;
  }
  if (isLabelable(node)) markLabelable(node, state);
  if (state.main === null && frame.body && (tag === 'main' || roleOf(node) === 'main')) state.main = { node, elements: state.elements, text: textAt };
  if (tag === 'form') readForm(node, state);
  else if (tag === 'label') {
    const text = labelHasText(node);
    state.labelText.set(node, text);
    const target = attr(node, 'for');
    if (target && text) state.labelFor.add(target);
  } else if (tag === 'script') {
    if (!state.tcf && attr(node, 'src') === null && (node.childNodes?.[0]?.value ?? '').slice(0, SCRIPT_PREFIX).includes('__tcfapi')) state.tcf = true;
  } else if (tag === 'iframe') {
    if (attr(node, 'name') === '__tcfapiLocator') state.tcf = true;
  } else if (tag === 'button') {
    actionElement(node, frame, state, 'button', textAt);
  } else if (tag === 'input' || tag === 'select' || tag === 'textarea') {
    const type = tag === 'input' ? (attr(node, 'type') ?? '').trim().toLowerCase() || 'text' : tag;
    if (tag === 'input' && ACTION_INPUTS.has(type)) actionElement(node, frame, state, 'input', textAt);
    if (!(tag === 'input' && NOT_FILLED.has(type))) readControl(node, tag, type, state);
  }
}

/**
 * Remember the id of an element outside the HTML namespace (an SVG `<title>` that `aria-labelledby` names). Nothing
 * else of such an element is read.
 * @param {DomNode} node
 * @param {FormsState} state
 */
export function visitForeignElement(node, state) {
  if (state.failed) return;
  const id = attr(node, 'id');
  if (id === null || id === '' || state.firstById.has(id)) return;
  if (state.firstById.size < MAX_IDS) state.firstById.set(id, node);
  else state.idsFull = true;
}

/**
 * Read what one element adds. An error stops the reading of this page's forms
 * (the record is then marked `failed`) and never the rest of the extraction.
 * Caps: `MAX_FORMS` forms, `MAX_SEEN_CONTROLS` controls looked at.
 * @param {DomNode} node
 * @param {Frame} frame
 * @param {FormsState} state
 * @param {number} textAt  How many pieces of visible text the walk has collected so far.
 */
export function visitForms(node, frame, state, textAt) {
  if (state.failed) return;
  try {
    read(node, frame, state, textAt);
  } catch {
    state.failed = true;
  }
}

/**
 * @param {PendingControl} control @param {FormsState} state
 * @returns {NameSource}
 */
function nameSource(control, state) {
  /** @param {string} id @returns {DomNode|undefined} */
  const target = (id) => state.firstById.get(id);
  // An id the page has but past the remembered ones could give the name: not known, so not judged.
  const unknown = (/** @type {string} */ id) => state.idsFull && target(id) === undefined;
  if (control.labelledby.some((id) => { const node = target(id); return node !== undefined && node !== control.node && givesName(node, state); })) return 'labelledby';
  if (control.own === 'aria_label') return 'aria_label';
  if (control.rawId !== null && state.labelFor.has(control.rawId)) {
    if (target(control.rawId) === control.node) return 'label';
    if (unknown(control.rawId)) return 'unknown';
  }
  if (control.wrapped) return 'wrapping_label';
  if (control.own !== null) return control.own;
  return control.labelledby.some(unknown) ? 'unknown' : 'none';
}

/**
 * The forms record of a page once it was walked: the name source of each
 * control, the form each belongs to, the field count of each form, and the
 * first action element with the words before it in `text`.
 * @param {FormsState} state
 * @param {string[]} text  The pieces of visible text the walk collected.
 * @param {RegExp} word    What counts as a word (global).
 * @returns {FormsRecord}
 */
export function formsRecord(state, text, word) {
  if (state.failed) return { ...emptyForms(), failed: true };
  try {
    for (const control of state.pending) {
      const form = control.formAttr !== null ? (state.formIds.get(control.formAttr) ?? null) : control.form;
      control.record.form = form;
      control.record.named_by = nameSource(control, state);
      if (form !== null) {
        state.forms[form].fields += 1;
        if (control.record.type === 'search') state.forms[form].search = true;
      }
    }
    if (state.pending.length > MAX_CONTROLS) state.limits.add('forms.controls');
    if (state.pending.some((control) => control.record.named_by === 'unknown')) state.limits.add('forms.ids');
    return {
      forms: state.forms, controls: state.pending.slice(0, MAX_CONTROLS).map((control) => control.record), hidden_controls: state.hidden,
      ...(state.unjudged > 0 ? { unjudged_controls: state.unjudged } : {}),
      ...(state.pending.length > MAX_CONTROLS ? { visible_controls: state.pending.length } : {}),
      ...(state.unread > 0 ? { unread_controls: state.unread } : {}),
      tcf_stub: state.tcf, first_action: firstAction(state, text, word),
    };
  } catch {
    return { ...emptyForms(), failed: true };
  }
}

/**
 * @param {FormsState} state @param {string[]} text @param {RegExp} word
 * @returns {FirstAction|null}
 */
function firstAction(state, text, word) {
  const { action, main } = state;
  // With a main element, only an action inside it counts: one in the header comes before the page's own content.
  if (action === null || (main !== null && !action.inMain)) return null;
  const from = action.inMain && main !== null ? main : { elements: 0, text: 0 };
  const before = text.slice(from.text, action.text).join('');
  return {
    in_main: action.inMain, tag: action.tag, words_before: before.match(word)?.length ?? 0,
    elements_before: Math.max(0, action.elements - from.elements), line: action.line,
  };
}

/**
 * The caps the reading of a page's forms reached: `forms`, `forms.controls`, `forms.ids` (an id that could give a
 * name was past the remembered ones) and `forms.depth` (a control whose ancestors could not all be read).
 * @param {FormsState} state
 * @returns {string[]}
 */
export function formsLimits(state) {
  return [...state.limits].sort();
}
