// Whether an element is hidden from visitors by its own markup: the `hidden`
// attribute, an inline `style`, or the size attributes of a frame. Only what
// the HTML itself says is read; style sheets and scripts are not. Pure, and
// linear in the length of every value it reads.

/**
 * How an element is hidden and which element hides it.
 * @typedef {Object} Concealment
 * @property {string} how      'display:none', 'hidden attribute', 'visibility:hidden', 'font-size:0', 'off-screen', 'zero size'.
 * @property {string} element  The hiding element as `tag[attribute]`, clipped.
 * @property {number|null} line
 * @property {string|null} id   The hiding element's `id`, so that a control on the page that reveals it can be found.
 * @property {boolean} revealable  The element is built to be opened by the visitor (see `enterElement`).
 */

/**
 * What is hidden above a node, per way of hiding, outermost element first.
 * Visibility and font size can be undone by a descendant; the others cannot.
 * An empty list means not hidden that way. Each list keeps at most
 * `MAX_PER_KIND` elements and stops growing once it holds one that is
 * neither built to be opened nor has an `id` a control could name, because
 * that one hides the content whatever the others are.
 * @typedef {Object} HiddenState
 * @property {readonly Concealment[]} gone        display:none or the hidden attribute.
 * @property {readonly Concealment[]} visibility
 * @property {readonly Concealment[]} fontSize
 * @property {readonly Concealment[]} offscreen
 * @property {readonly Concealment[]} zeroSize
 */

/** @type {HiddenState} */
export const VISIBLE = Object.freeze({ gone: [], visibility: [], fontSize: [], offscreen: [], zeroSize: [] });
const MAX_PER_KIND = 4;

/**
 * The list with `entry` added, unless it already holds a concealment that
 * hides for certain. When full, one that hides for certain takes the place of
 * any other, and one with an id that of one a control opens, so that wrappers
 * built to be opened cannot push the hiding of injected content out.
 * @param {readonly Concealment[]} list
 * @param {Concealment} entry
 * @returns {readonly Concealment[]}
 */
function add(list, entry) {
  if (list.some((item) => !item.revealable && item.id === null)) return list;
  if (list.length < MAX_PER_KIND) return [...list, entry];
  if (entry.revealable) return list;
  const replaced = entry.id === null ? 0 : list.findIndex((item) => item.revealable);
  return replaced < 0 ? list : list.map((item, i) => (i === replaced ? entry : item));
}

/** At this many pixels to the left of or above its place, or further, an element is off-screen. */
export const OFFSCREEN_PX = 1000;
/** A box this small or smaller that clips its content shows nothing; so does a frame. */
export const TINY_PX = 2;
/** A font size this small or smaller cannot be read. */
export const TINY_FONT_PX = 1;
/** Only this much of a `style` attribute is read; a longer one is cut there. */
export const MAX_STYLE_CHARS = 20_000;
/** A value longer than this is not a length. */
const MAX_LENGTH_CHARS = 40;
const ELEMENT_CHARS = 120;
const LENGTH = /^(-?(?:\d+(?:\.\d*)?|\.\d+))(px|pt|pc|em|rem|ch|ex|%|vw|vh|vmin|vmax|in|cm|mm)?$/;
/**
 * Pixels per unit. Font-relative units count as 16 px. Percentages and
 * viewport units have no size of their own (an off-canvas menu moved by
 * -100% is a menu), so they are not lengths here, except that 0 is 0.
 */
const PX_PER_UNIT = /** @type {Record<string, number>} */ ({
  px: 1, pt: 4 / 3, pc: 16, em: 16, rem: 16, ch: 8, ex: 8, in: 96, cm: 37.8, mm: 3.78,
});
/** Units and keywords whose font size depends on the parent's: under a font size of 0 they stay 0. */
const RELATIVE_FONT = /^(?:inherit|unset|smaller|larger|-?[\d.]+(?:em|%|ex|ch))$/;
/** Positions under which `left`, `top`, `right` and `bottom` move the box. */
const MOVING_POSITIONS = new Set(['absolute', 'fixed', 'relative']);
/** Offsets that move a box left or up when negative, and those that move it left or up when positive. */
const NEGATIVE_OFFSETS = ['left', 'top', 'margin-left', 'margin-top'];
const POSITIVE_OFFSETS = ['right', 'bottom'];
const TRANSLATE = /translate(3d|x|y)?\(([^)]{0,200})\)/g;

/**
 * Declarations of an inline style, lower-cased names, values trimmed and
 * without `!important`. The last declaration of a property wins, as in CSS.
 * Comments are removed and at most `MAX_STYLE_CHARS` characters are read.
 * @param {string|null} style
 * @returns {Map<string, string>}
 */
export function parseStyle(style) {
  /** @type {Map<string, string>} */
  const declarations = new Map();
  if (!style) return declarations;
  const text = style.length > MAX_STYLE_CHARS ? style.slice(0, MAX_STYLE_CHARS) : style;
  let plain = '';
  for (let at = 0; at < text.length;) {
    const open = text.indexOf('/*', at);
    if (open < 0) {
      plain += text.slice(at);
      break;
    }
    plain += text.slice(at, open);
    const close = text.indexOf('*/', open + 2);
    if (close < 0) break;
    at = close + 2;
  }
  for (const part of plain.split(';')) {
    const colon = part.indexOf(':');
    if (colon < 0) continue;
    const name = part.slice(0, colon).trim().toLowerCase();
    let value = part.slice(colon + 1).trim().toLowerCase();
    if (value.endsWith('important')) value = value.replace(/!\s*important$/, '').trim();
    if (name !== '' && value !== '') declarations.set(name, value);
  }
  return declarations;
}

/**
 * A CSS length in pixels; null when it is not a plain length. `0` without a
 * unit is 0.
 * @param {string|undefined} value
 * @returns {number|null}
 */
export function lengthPx(value) {
  if (value === undefined || value.length > MAX_LENGTH_CHARS) return null;
  const match = LENGTH.exec(value.trim());
  if (!match) return null;
  const number = Number(match[1]);
  if (!Number.isFinite(number)) return null;
  if (match[2] === undefined || !Object.hasOwn(PX_PER_UNIT, match[2])) return number === 0 ? 0 : null;
  return number * PX_PER_UNIT[match[2]];
}

/**
 * @param {Map<string, string>} style
 * @returns {boolean} True when the inline style moves the box at least `OFFSCREEN_PX` to the left or up, off the page.
 */
function offscreen(style) {
  const far = (/** @type {string|undefined} */ value, sign = -1) => {
    const px = lengthPx(value?.trim());
    return px !== null && sign * px >= OFFSCREEN_PX;
  };
  const positioned = MOVING_POSITIONS.has(style.get('position') ?? '');
  const moves = (/** @type {string} */ name) => positioned || name.startsWith('margin');
  if (NEGATIVE_OFFSETS.some((name) => moves(name) && far(style.get(name)))) return true;
  if (positioned && POSITIVE_OFFSETS.some((name) => far(style.get(name), 1))) return true;
  const transform = style.get('transform') ?? '';
  for (const match of transform.matchAll(TRANSLATE)) {
    const values = match[2].split(',');
    // translateX and translateY take one value; translate and translate3d take x and y first (z moves nothing on screen).
    if (values.slice(0, match[1] === 'x' || match[1] === 'y' ? 1 : 2).some((value) => far(value))) return true;
  }
  return false;
}

/**
 * Padding that gives a box size along one axis, in any of the ways CSS can
 * say it: the `padding` shorthand (one to four values, top right bottom left),
 * the longhands, and the logical properties. A value that is not 0 counts.
 * @param {Map<string, string>} style
 * @param {'vertical'|'horizontal'} axis
 * @returns {boolean}
 */
function padded(style, axis) {
  const vertical = axis === 'vertical';
  /** @type {(string|undefined)[]} */
  const values = vertical
    ? ['padding-top', 'padding-bottom', 'padding-block', 'padding-block-start', 'padding-block-end'].map((name) => style.get(name))
    : ['padding-left', 'padding-right', 'padding-inline', 'padding-inline-start', 'padding-inline-end'].map((name) => style.get(name));
  const shorthand = (style.get('padding') ?? '').split(/\s+/).filter(Boolean);
  if (shorthand.length > 0) {
    const [top, right = top, bottom = top, left = right] = shorthand;
    values.push(...(vertical ? [top, bottom] : [right, left]));
  }
  return values.some((value) => value !== undefined && value.split(/\s+/).some((part) => part !== '' && lengthPx(part) !== 0));
}

/**
 * @param {Map<string, string>} style
 * @returns {boolean} True when a width or height of `TINY_PX` or less, with no padding on that axis, clips everything
 *   inside. The pattern for text meant for screen readers (a `clip` or `clip-path` with a 1 px box) does not count.
 */
function tinyBox(style) {
  if (!['hidden', 'clip'].includes(style.get('overflow') ?? '') || style.has('clip') || style.has('clip-path')) return false;
  const tiny = (/** @type {string} */ name) => {
    const px = lengthPx(style.get(name));
    return px !== null && px <= TINY_PX;
  };
  return ((tiny('height') || tiny('max-height')) && !padded(style, 'vertical'))
    || ((tiny('width') || tiny('max-width')) && !padded(style, 'horizontal'));
}

/**
 * @param {string} tag
 * @param {string} attribute
 * @param {{line: number|null, id: string|null, revealable: boolean}} element
 * @param {string} how
 * @returns {Concealment}
 */
function concealment(tag, attribute, element, how) {
  const described = `${tag}[${attribute}]`;
  return {
    how,
    element: described.length > ELEMENT_CHARS ? `${described.slice(0, ELEMENT_CHARS - 2)}…]` : described,
    line: element.line,
    id: element.id,
    revealable: element.revealable,
  };
}

/**
 * The hidden state below an element, from the state above it and the
 * element's own `hidden` and `style` attributes. `hidden="until-found"` is
 * content a visitor can reveal by searching the page, so it does not hide.
 * `opacity: 0` and `text-indent` are not read: animation libraries start
 * content at opacity 0 and fade it in, and a negative text indent moves the
 * text of a box that is still there (a logo drawn as a background image).
 *
 * `revealable` says the element is built to be opened by the visitor (a
 * dialog, menu, tab panel, tooltip or popover, or content right after a
 * button); `classed` says it has a `class`, through which a style sheet may
 * give it a font size of its own.
 * @param {HiddenState} parent
 * @param {{tag: string, hidden: string|null, style: string|null, line: number|null, id?: string|null,
 *          revealable?: boolean, classed?: boolean}} element
 * @returns {HiddenState}
 */
export function enterElement(parent, { tag, hidden, style, line, id = null, revealable = false, classed = false }) {
  const declarations = parseStyle(style);
  if (declarations.size === 0 && hidden === null) {
    return classed && parent.fontSize.length > 0 ? { ...parent, fontSize: [] } : parent;
  }
  const raw = (style ?? '').replace(/\s+/g, ' ').trim();
  const about = { line, id: id === null || id.trim() === '' ? null : id.trim(), revealable };
  const styled = (/** @type {string} */ how) => concealment(tag, `style="${raw}"`, about, how);
  const next = { ...parent };
  const display = declarations.get('display');
  if (display === 'none') next.gone = add(next.gone, styled('display:none'));
  else if (hidden !== null && hidden.trim().toLowerCase() !== 'until-found' && display === undefined) {
    next.gone = add(next.gone, concealment(tag, 'hidden', about, 'hidden attribute'));
  }
  const visibility = declarations.get('visibility');
  if (visibility === 'visible') next.visibility = [];
  else if (visibility === 'hidden' || visibility === 'collapse') next.visibility = add(next.visibility, styled('visibility:hidden'));
  const fontSize = declarations.get('font-size');
  const fontPx = fontSize === undefined ? null : lengthPx(fontSize);
  if (fontPx !== null && fontPx <= TINY_FONT_PX) next.fontSize = add(next.fontSize, styled('font-size:0'));
  else if (classed || (fontSize !== undefined && !(next.fontSize.length > 0 && RELATIVE_FONT.test(fontSize)))) next.fontSize = [];
  if (offscreen(declarations)) next.offscreen = add(next.offscreen, styled('off-screen'));
  if (tinyBox(declarations)) next.zeroSize = add(next.zeroSize, styled('zero size'));
  return next;
}

/**
 * Both states at once: what hides content in either place hides it. Used for
 * content a script moves from one place to another, where a visitor may see
 * it in either.
 * @param {HiddenState} first
 * @param {HiddenState} second
 * @returns {HiddenState}
 */
export function combineStates(first, second) {
  if (first === second || second === VISIBLE) return first;
  if (first === VISIBLE) return second;
  /** @param {readonly Concealment[]} a @param {readonly Concealment[]} b */
  const merge = (a, b) => b.reduce((list, entry) => (list.includes(entry) ? list : add(list, entry)), a);
  return {
    gone: merge(first.gone, second.gone),
    visibility: merge(first.visibility, second.visibility),
    fontSize: merge(first.fontSize, second.fontSize),
    offscreen: merge(first.offscreen, second.offscreen),
    zeroSize: merge(first.zeroSize, second.zeroSize),
  };
}

/**
 * Every element that hides the content, by way of hiding, outermost first; empty when nothing does.
 * @param {HiddenState} state
 * @returns {Concealment[]}
 */
export function concealments(state) {
  return [...state.gone, ...state.visibility, ...state.fontSize, ...state.offscreen, ...state.zeroSize];
}

/**
 * True for a frame whose width or height is `TINY_PX` or less: nothing of it
 * can be seen. The inline style wins over the `width` and `height` attributes,
 * as it does in CSS.
 * @param {{width: string|null, height: string|null, style: string|null}} frame
 * @returns {boolean}
 */
export function tinyFrame({ width, height, style }) {
  const declarations = parseStyle(style);
  const small = (/** @type {string|null|undefined} */ value) => {
    if (value === null || value === undefined) return false;
    const trimmed = value.trim().toLowerCase();
    const px = /^\d{1,9}$/.test(trimmed) ? Number(trimmed) : lengthPx(trimmed);
    return px !== null && px <= TINY_PX;
  };
  return small(declarations.get('width') ?? width) || small(declarations.get('height') ?? height);
}
