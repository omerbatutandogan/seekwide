import assert from 'node:assert/strict';
import { test } from 'node:test';

import { CATEGORIES, SCRIPT_SAMPLE_CHARS, SPAM_TERMS, TOPIC_WORDS, foldCase, scriptLetters, spamTermHits, topicHits, urlWords } from '../../plugin/server/src/extract/terms.js';

test('spam terms match whole words in any letter case, with any space between the words of a phrase', () => {
  assert.deepEqual(spamTermHits(['Buy VIAGRA and Cialis', 'online\n  casino here']), {
    pharma: { count: 2, terms: ['viagra', 'cialis'] },
    gambling: { count: 1, terms: ['online casino'] },
  });
  assert.deepEqual(spamTermHits(['viagrafree', 'antiviagra', 'slot88x', 'togeli']), {}, 'parts of longer words do not count');
  assert.deepEqual(spamTermHits(['Book your delivery slot online.', 'Coin Master free spins today', 'Michael Kors Outlet, level 2']), {}, 'phrases ordinary pages use');
  assert.deepEqual(spamTermHits(['', '   ']), {});
});

test('Turkish dotted capitals match, and at most five distinct terms are kept', () => {
  assert.deepEqual(spamTermHits(['KAÇAK BAHİS ve CANLI BAHİS', 'canlı bahis']).gambling, { count: 3, terms: ['kaçak bahis', 'canli bahis'] });
  assert.equal(foldCase('İSTANBUL'), 'istanbul');
  const many = spamTermHits(['togel sbobet maxwin slot88 situs judi agen judi togel']);
  assert.deepEqual(many.gambling, { count: 7, terms: ['togel', 'sbobet', 'maxwin', 'slot88', 'situs judi'] });
});

test('topic words count the spam terms and the words that name the subject', () => {
  assert.deepEqual(topicHits(['Online Pharmacy', 'Garden tools']), { pharma: { count: 1, terms: ['online pharmacy'] } });
  assert.deepEqual(topicHits(['Health news today']).pharma, { count: 1, terms: ['health'] });
  assert.deepEqual(topicHits(['Best Casinos of 2026']).gambling, { count: 1, terms: ['casinos'] });
  assert.deepEqual(topicHits(['Fashion and watches']).counterfeit, { count: 2, terms: ['fashion', 'watches'] });
});

test('every category has spam terms and topic words, all lower-case', () => {
  for (const category of CATEGORIES) {
    assert.ok(SPAM_TERMS[category].length > 0 && TOPIC_WORDS[category].length > 0, category);
    for (const term of [...SPAM_TERMS[category], ...TOPIC_WORDS[category]]) assert.equal(term, term.toLowerCase().trim());
  }
});

test('URLs read as the words of their host, path and query', () => {
  assert.equal(urlWords('https://shop.test/cheap-viagra_online?q=x%20cialis').trim(), 'shop test cheap viagra online q x cialis');
  assert.equal(urlWords('not a url %zz').trim(), 'not a url zz');
});

test('letters are counted per writing system on the start of the text', () => {
  assert.deepEqual(scriptLetters('Hello Привет Γειά مرحبا שלום नमस्ते สวัสดี 안녕 日本語 ひらがな カタカナ বাংলা 123 !'), {
    latin: 5, cyrillic: 6, greek: 4, arabic: 5, hebrew: 4, devanagari: 4, thai: 4, hangul: 2, cjk: 11, other: 2,
  });
  assert.deepEqual(scriptLetters(''), {});
  assert.equal(scriptLetters(`${'a'.repeat(SCRIPT_SAMPLE_CHARS)}${'Я'.repeat(100)}`).cyrillic, undefined);
});
