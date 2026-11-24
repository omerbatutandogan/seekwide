// What the ai module's agent readiness checks read from a page's markup (rule set 0.2.2): the WebMCP attributes of each
// form and the visible buttons without a name.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { extractHtml } from '../../plugin/server/src/extract/html.js';
import { MAX_BUTTON_EXAMPLES, emptyForms } from '../../plugin/server/src/extract/forms.js';

/** @param {string} body */
const read = (body) => /** @type {import('../../plugin/server/src/types.js').FormsRecord} */ (
  extractHtml(`<html><head><title>T</title></head><body>${body}</body></html>`, { responseUrl: 'https://example.test/c', siteHost: 'example.test', includeSubdomains: false }).forms);

test('a form records its WebMCP toolname and tooldescription', () => {
  const { forms } = read('<form toolname=" book_table " tooldescription="Book a table   for dinner"></form><form toolname=""></form><form></form>');
  assert.deepEqual(forms.map((form) => [form.tool_name, form.tool_description]), [['book_table', 'Book a table for dinner'], [null, null], [null, null]]);
});

test('visible buttons and those without a name', () => {
  const record = read([
    '<button>Send</button>',
    '<button aria-label="Close"><svg></svg></button>',
    '<button><img src="x.png" alt="Search"></button>',
    '<button><svg><title>Menu</title></svg></button>',
    '<button title="More"></button>',
    '<button :aria-label="label"></button>',
    '<button aria-labelledby="cap"></button><span id="cap">Next</span>',
    '<button type="button"><svg></svg></button>',
    '<button><img src="x.png" alt=""></button>',
    '<button aria-labelledby="nowhere"></button>',
    '<input type="button" value="Go"><input type="button"><input type="image" src="go.png"><input type="image" src="go.png" alt="Go">',
    '<input type="submit"><input type="reset">',
    '<button hidden></button><div style="display:none"><button></button></div><button aria-hidden="true"></button>',
  ].join(''));
  assert.deepEqual(record.buttons, {
    visible: 14, unnamed: 5,
    examples: [
      { tag: 'button', type: 'button', line: 1 }, { tag: 'button', type: 'submit', line: 1 }, { tag: 'button', type: 'submit', line: 1 },
      { tag: 'input', type: 'button', line: 1 }, { tag: 'input', type: 'image', line: 1 },
    ],
  }, 'hidden ones are not read; submit and reset inputs are named by the browser');
});

test('the examples of unnamed buttons are capped, the count is not', () => {
  const record = read('<button></button>'.repeat(MAX_BUTTON_EXAMPLES + 5));
  assert.equal(record.buttons?.unnamed, MAX_BUTTON_EXAMPLES + 5);
  assert.equal(record.buttons?.examples.length, MAX_BUTTON_EXAMPLES);
  assert.deepEqual(emptyForms().buttons, { visible: 0, unnamed: 0, examples: [] });
});
