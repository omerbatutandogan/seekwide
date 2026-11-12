import assert from 'node:assert/strict';
import { test } from 'node:test';

import { MAX_STYLE_CHARS, VISIBLE, concealments, enterElement, lengthPx, parseStyle, tinyFrame } from '../../server/src/extract/concealment.js';

/** CPU time this process has used, in milliseconds. */
const cpuMs = () => {
  const usage = process.cpuUsage();
  return (usage.user + usage.system) / 1000;
};

/**
 * How a chain of elements, outermost first, hides the innermost one; null when it does not.
 * @param {{tag?: string, hidden?: string|null, style?: string|null, id?: string|null, revealable?: boolean, classed?: boolean}[]} chain
 */
function hiddenBy(chain) {
  let state = VISIBLE;
  for (const element of chain) {
    state = enterElement(state, {
      tag: element.tag ?? 'div', hidden: element.hidden ?? null, style: element.style ?? null, line: 3,
      id: element.id ?? null, revealable: element.revealable ?? false, classed: element.classed ?? false,
    });
  }
  return concealments(state)[0] ?? null;
}

test('inline styles are parsed like CSS: names in any case, the last declaration wins, !important and comments dropped', () => {
  assert.deepEqual([...parseStyle(' DISPLAY : Block ; display:none !important; /* x; y */ color:red;;bad')], [['display', 'none'], ['color', 'red']]);
  assert.deepEqual([...parseStyle('display:none; /* never closed')], [['display', 'none']]);
  assert.equal(parseStyle(null).size, 0);
});

test('lengths convert to pixels; a bare 0 is 0 and other bare numbers are not lengths', () => {
  assert.equal(lengthPx('0'), 0);
  assert.equal(lengthPx('-9999px'), -9999);
  assert.equal(lengthPx('-100em'), -1600);
  assert.equal(lengthPx('-.5rem'), -8);
  assert.equal(lengthPx('12'), null);
  assert.equal(lengthPx('auto'), null);
  assert.equal(lengthPx(undefined), null);
  assert.equal(lengthPx(`${'1'.repeat(41)}px`), null, 'too long to be a length');
  assert.equal(lengthPx('-100%'), null, 'a percentage has no size of its own');
  assert.equal(lengthPx('-100vw'), null);
  assert.equal(lengthPx('0%'), 0);
});

test('each way of hiding that the markup can state is recognised', () => {
  assert.equal(hiddenBy([{ style: 'display:none' }])?.how, 'display:none');
  assert.equal(hiddenBy([{ hidden: '' }])?.how, 'hidden attribute');
  assert.equal(hiddenBy([{ style: 'visibility: hidden' }])?.how, 'visibility:hidden');
  assert.equal(hiddenBy([{ style: 'visibility:collapse' }])?.how, 'visibility:hidden');
  assert.equal(hiddenBy([{ style: 'font-size:0px' }])?.how, 'font-size:0');
  assert.equal(hiddenBy([{ style: 'font-size:1px' }])?.how, 'font-size:0');
  assert.equal(hiddenBy([{ style: 'position:absolute; left:-9999px' }])?.how, 'off-screen');
  assert.equal(hiddenBy([{ style: 'position:relative; left:-9999px' }])?.how, 'off-screen');
  assert.equal(hiddenBy([{ style: 'position:fixed; top:-1000px' }])?.how, 'off-screen');
  assert.equal(hiddenBy([{ style: 'margin-left:-5000px' }])?.how, 'off-screen');
  assert.equal(hiddenBy([{ style: 'transform: translateX(-9999px)' }])?.how, 'off-screen');
  assert.equal(hiddenBy([{ style: 'transform: translate3d(0, -2000px, 0)' }])?.how, 'off-screen');
  assert.equal(hiddenBy([{ style: 'height:0;overflow:hidden' }])?.how, 'zero size');
  assert.equal(hiddenBy([{ style: 'height:1px;overflow:hidden' }])?.how, 'zero size');
  assert.equal(hiddenBy([{ style: 'max-width:0; overflow:clip' }])?.how, 'zero size');
  assert.equal(hiddenBy([{ style: 'position:absolute; right:9999px' }])?.how, 'off-screen', 'right pushes the box to the left');
  assert.equal(hiddenBy([{ style: 'position:absolute; bottom:9999px' }])?.how, 'off-screen');
  assert.equal(hiddenBy([{ style: 'height:0;overflow:hidden;padding:0 10px' }])?.how, 'zero size', 'padding on the other axis only');
});

test('markup that does not hide content is not mistaken for hiding', () => {
  assert.equal(hiddenBy([{ style: 'display:block' }]), null);
  assert.equal(hiddenBy([{ hidden: 'until-found' }]), null, 'found by searching the page');
  assert.equal(hiddenBy([{ hidden: '', style: 'display:flex' }]), null, 'an inline display overrides the attribute');
  assert.equal(hiddenBy([{ style: 'left:-9999px' }]), null, 'an offset without positioning does nothing');
  assert.equal(hiddenBy([{ style: 'position:sticky; left:-9999px' }]), null, 'a sticky offset is a threshold, not a move');
  assert.equal(hiddenBy([{ style: 'position:absolute; left:-999px' }]), null, 'less than 1000 px');
  assert.equal(hiddenBy([{ style: 'height:0' }]), null, 'content overflows a zero box that does not clip');
  assert.equal(hiddenBy([{ style: 'opacity:0;transform:translateY(20px)' }]), null, 'an animation start state');
  assert.equal(hiddenBy([{ style: 'opacity:0' }]), null, 'opacity is not read');
  assert.equal(hiddenBy([{ style: 'display:block;text-indent:-9999px;background:url(/logo.png)' }]), null, 'a logo drawn as a background image');
  assert.equal(hiddenBy([{ style: 'position:absolute; clip:rect(0 0 0 0); width:1px; height:1px; overflow:hidden' }]), null, 'text for screen readers');
  assert.equal(hiddenBy([{ style: 'position:relative;width:100%;height:0;padding-top:56.25%;overflow:hidden' }]), null, 'a responsive embed');
  assert.equal(hiddenBy([{ style: 'overflow:hidden;padding-bottom:56.25%;position:relative;height:0;' }]), null, 'a responsive map');
  assert.equal(hiddenBy([{ style: 'height:0;padding:0 0 75% 0;overflow:hidden' }]), null, 'padding shorthand');
  assert.equal(hiddenBy([{ style: 'height:0;overflow:hidden;padding-block-end:56%' }]), null, 'logical padding');
  assert.equal(hiddenBy([{ style: 'transform:translateX(-100%)' }]), null, 'an off-canvas menu');
  assert.equal(hiddenBy([{ style: 'position:absolute;left:-100vw' }]), null);
  assert.equal(hiddenBy([{ style: 'transform:translate(-50%,-50%)' }]), null, 'centring');
  assert.equal(hiddenBy([{ style: 'transform:translate3d(0,0,-9999px)' }]), null, 'depth moves nothing on screen');
  assert.equal(hiddenBy([{ style: 'position:absolute; right:-9999px' }]), null, 'pushed right, the page scrolls to it');
});

test('a descendant can undo visibility and an absolute font size, but not display or an off-screen parent', () => {
  assert.equal(hiddenBy([{ style: 'visibility:hidden' }, { style: 'visibility:visible' }]), null);
  assert.equal(hiddenBy([{ style: 'font-size:0' }, { style: 'font-size:16px' }]), null);
  assert.equal(hiddenBy([{ style: 'font-size:0' }, { style: 'font-size:medium' }]), null);
  assert.equal(hiddenBy([{ style: 'font-size:0' }, { classed: true }]), null, 'a class can give it a size');
  assert.equal(hiddenBy([{ style: 'font-size:0' }, { style: 'font-size:1.2em' }])?.how, 'font-size:0', 'em of 0 is 0');
  assert.equal(hiddenBy([{ style: 'font-size:0' }, { style: 'font-size:inherit' }])?.how, 'font-size:0');
  assert.equal(hiddenBy([{ style: 'display:none' }, { style: 'display:block' }])?.how, 'display:none');
  assert.equal(hiddenBy([{ style: 'position:absolute;left:-9999px' }, { style: 'position:static' }])?.how, 'off-screen');
});

test('the hiding element is described with its tag, attribute, line, id and whether it is built to be opened', () => {
  assert.deepEqual(hiddenBy([{ tag: 'section', style: 'display:none', id: ' menu ', revealable: true }, { tag: 'p' }]), {
    how: 'display:none', element: 'section[style="display:none"]', line: 3, id: 'menu', revealable: true,
  });
  const long = hiddenBy([{ style: `display:none;${'x:y;'.repeat(80)}` }]);
  assert.ok((long?.element.length ?? 0) <= 120);
  assert.ok(long?.element.endsWith('…]'));
});

test('every element that hides the content is listed, by way of hiding, outermost first', () => {
  let state = enterElement(VISIBLE, { tag: 'div', hidden: null, style: 'display:none', line: 1, id: 'modal', revealable: true });
  state = enterElement(state, { tag: 'div', hidden: null, style: 'position:absolute;left:-9999px', line: 2 });
  state = enterElement(state, { tag: 'div', hidden: '', style: null, line: 3 });
  assert.deepEqual(concealments(state).map((entry) => [entry.how, entry.line, entry.revealable]), [
    ['display:none', 1, true], ['hidden attribute', 3, false], ['off-screen', 2, false],
  ]);
  // Once an element hides for certain, the elements inside it add nothing that could change the answer.
  const certain = enterElement(enterElement(state, { tag: 'p', hidden: '', style: null, line: 4 }), { tag: 'p', hidden: '', style: null, line: 5 });
  assert.equal(certain.gone.length, 2);
});

test('a frame of 2 pixels or less in either direction is tiny', () => {
  assert.equal(tinyFrame({ width: '0', height: '0', style: null }), true);
  assert.equal(tinyFrame({ width: '2', height: '2', style: null }), true);
  assert.equal(tinyFrame({ width: '600', height: '1', style: null }), true);
  assert.equal(tinyFrame({ width: null, height: null, style: 'width:1px;height:400px' }), true);
  assert.equal(tinyFrame({ width: '100%', height: '315', style: null }), false);
  assert.equal(tinyFrame({ width: null, height: null, style: null }), false);
  assert.equal(tinyFrame({ width: '560', height: '0', style: 'height:315px' }), false, 'the style wins over the attribute');
  assert.equal(tinyFrame({ width: '560', height: '315', style: 'height:0' }), true);
});

test('reading a style takes linear time, however the value is built', () => {
  const started = cpuMs();
  lengthPx(`${'1'.repeat(40_000)}x`);
  parseStyle('/* '.repeat(80_000));
  parseStyle(`opacity:${'1'.repeat(40_000)}x; height:${'1'.repeat(40_000)}x; left:${'1'.repeat(40_000)}x`);
  enterElement(VISIBLE, { tag: 'div', hidden: null, style: `transform:${'translate('.repeat(20_000)}; font-size:${'9'.repeat(40_000)}x`, line: 1 });
  const elapsed = cpuMs() - started;
  assert.ok(elapsed < 2000, `took ${elapsed} ms of CPU time`);
  assert.equal(parseStyle(`${'a:b;'.repeat(MAX_STYLE_CHARS)}display:none`).has('display'), false, 'only the start of a long style is read');
});
