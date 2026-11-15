// What the cro module reads from a page's forms, and the observations of a run
// (rule set 0.2.1). No runtime code.

export {};

/**
 * One `<form>` element of a page.
 * @typedef {Object} FormRecord
 * @property {number|null} line
 * @property {string|null} id         `id` attribute, trimmed and clipped to 100 characters; null when absent or empty.
 * @property {string|null} name       `name` attribute, the same way.
 * @property {string|null} action     The `action` resolved against the page's base URL; null when the attribute is absent,
 *   empty or not an http(s) URL. Never requested by any part of the plugin.
 * @property {string} method          `method`, lower-cased and clipped; 'get' when absent.
 * @property {boolean} search         A search form: `role="search"` on it or an element around it, inside a `<search>` element,
 *   or holding an `<input type="search">`.
 * @property {number} fields          Visible controls that belong to it (`ControlRecord.form`), counted past the stored cap too.
 */

/**
 * How a visible control gets its accessible name, the first source that gives one, in the order of HTML-AAM:
 * `labelledby` (an `aria-labelledby` id that exists on the page), `aria_label`, `label` (a `<label for>` with text),
 * `wrapping_label` (a `<label>` around it with text of its own), `title`, `binding` (a framework binding of
 * `aria-label`, `aria-labelledby` or `title`, whose value is set by a script), `placeholder` (a `placeholder` or a binding
 * of it), `none`, or `unknown` (an id that could give the name was past the ids the reading keeps: not judged).
 * `labelledby` needs an id whose first element is not the control and gives a name (text or `aria-label`); `label`
 * needs the control to be the first element with that id; a label around the control names it only when it has no `for`
 * and the control is its first labelable element, or its `for` is exactly the control's id.
 * @typedef {'labelledby'|'aria_label'|'label'|'wrapping_label'|'title'|'binding'|'placeholder'|'none'|'unknown'} NameSource
 */

/**
 * One visible form control: an `input` whose type is not hidden, submit, reset, button or image, a `select` or a
 * `textarea`, not hidden by its own markup or by an element around it (the `hidden` attribute, `aria-hidden="true"`,
 * an inline `display: none`, `visibility: hidden` or off-screen position).
 * @typedef {Object} ControlRecord
 * @property {number|null} form       Index in `FormsRecord.forms` of the form it belongs to (its `form` attribute, else the
 *   form around it); null when it belongs to none or that form was past the cap.
 * @property {'input'|'select'|'textarea'} tag
 * @property {string} type            Lower-cased `type` of an input ('text' when absent); the tag for the others.
 * @property {string|null} name       `name` attribute, trimmed and clipped to 100 characters.
 * @property {string|null} id         `id` attribute, the same way.
 * @property {string|null} autocomplete  `autocomplete` attribute, whitespace-collapsed and clipped to 100 characters; null when absent.
 * @property {boolean|null} [autocomplete_valid]  Whether the whole value, before clipping, follows the HTML standard's grammar
 *   (`util/autofill.js`); null without the attribute. Absent in records read before it existed.
 * @property {NameSource} named_by
 * @property {boolean} paste_blocked  Its inline `onpaste` handler contains `return false` or `preventDefault`.
 * @property {number|null} line
 */

/**
 * The first action element of a page in document order: the first `<button>` or `<input type="submit|button|image">`
 * inside the first `<main>` (or element with `role="main"`), else inside `<body>`. What it says is the HTML order only:
 * style sheets can show it elsewhere.
 * @typedef {Object} FirstAction
 * @property {boolean} in_main        Found inside the main element.
 * @property {'button'|'input'} tag
 * @property {number} words_before    Words of visible text between the start of the main element (or of the body) and it.
 * @property {number} elements_before Elements between the start of the main element (or of the body) and it.
 * @property {number|null} line
 */

/**
 * What the cro module reads from a page (`extract/forms.js`). Absent in records made before rule set 0.2.1.
 * @typedef {Object} FormsRecord
 * @property {FormRecord[]} forms      At most 50, in document order.
 * @property {ControlRecord[]} controls  Visible controls, at most 200, in document order.
 * @property {number} hidden_controls  Controls left out because their markup hides them (honeypot fields, closed panels).
 * @property {number} [unjudged_controls]  Controls left out because more elements sit above them than are read (`forms.depth`).
 * @property {number} [visible_controls]  How many visible controls the page has, when more than are kept (`forms.controls`).
 * @property {number} [unread_controls]  Controls past the 2,000 looked at, not read at all (`forms.controls`).
 * @property {boolean} tcf_stub       An inline script names `__tcfapi`, or a frame is named `__tcfapiLocator`: the IAB TCF
 *   consent API is on the page.
 * @property {FirstAction|null} first_action
 * @property {true} [upgrade_insecure]  The page upgrades insecure requests (Content-Security-Policy `upgrade-insecure-requests`
 *   as a header or a meta tag in the head), so an http action is upgraded too.
 * @property {true} [failed]          The reading of the forms stopped on an error; nothing else here is complete, and the page
 *   is not a unit of the checks that read forms.
 */

/**
 * A measurement without a pass/fail threshold, stored in `Run.observations` and shown in its own report section. It
 * never changes a score and is not a finding.
 * @typedef {Object} Observation
 * @property {string} id              `<module>.<name>`, for example "cro.consent_tool".
 * @property {string} module
 * @property {'measured'|'not_available'} status  `not_available`: nothing could be measured, and `reason` says why.
 * @property {string|null} reason     The plugin's own sentence on why nothing was measured; null when measured.
 * @property {Record<string, number|boolean|string|null>} values  Counts, flags and the plugin's own words (provider names);
 *   never text a page wrote.
 * @property {string[]} urls          Example page URLs, at most 5.
 * @property {string|null} source     The documentation the measurement is defined by, when there is one.
 */
