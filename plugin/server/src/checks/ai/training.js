// The training and grounding preferences a site states (ai module): the
// shared __usage_ai-training group, the Content-Usage and Content-Signal lines
// of robots.txt, and Bing's page-level ai-training and ai-grounding
// directives with the older noarchive and nocache they replace. Pure.

/** @import { CheckDef, CheckResult } from '../../types.js' */

import { botByToken } from '../../util/ai-bots.js';
import { AI, DOCS, ROBOTS_ONLY, bingAiDirectives, policyOf, searchBlockIntended, startUrlOf } from './helpers.js';

/** @type {CheckDef} */
const preferenceInvalid = {
  ...AI,
  id: 'ai.robots.training_preference_invalid',
  title: 'An AI training preference in robots.txt has no effect as written',
  description:
    'Reads the AI usage preferences of robots.txt: a "User-Agent: __usage_ai-training" group must have an Allow or Disallow rule to state anything (draft-kelley-aipref-training-preference-signal-00); a Content-Usage value must be a usage preference of the IETF aipref drafts (a dictionary such as "train-ai=n", whose train-ai, ai-use and search labels take y or n); a Content-Signal value must be name=value pairs in which Cloudflare\'s search, ai-input and ai-train signals take yes or no. The drafts may still change. One unit per group or line.',
  severity: 'low',
  weight: 1,
  impact: 1,
  effort: 1,
  confidence: 'likely',
  scope: 'site',
  requires: ['ai_robots'],
  doc_ref: DOCS.KELLEY_00,
  recommendation: 'Write the preference in the documented form: "User-Agent: __usage_ai-training" followed by "Disallow: /" (or Allow); "Content-Usage: train-ai=n"; "Content-Signal: search=yes, ai-train=no".',
  run(ctx) {
    const ai = ctx.crawl.ai_robots;
    if (!ai) return [];
    const url = ctx.crawl.robots.url;
    /** @type {CheckResult[]} */
    const results = [];
    if (ai.policy.group !== 'none') {
      results.push(ai.policy.group === 'rules'
        ? { status: 'pass', url, selector: '__usage_ai-training' }
        : {
          status: 'fail', url, selector: '__usage_ai-training',
          evidence: { observed: { group: '__usage_ai-training', rules: 0 }, expected: 'An Allow or Disallow rule in the group', detail: 'A group without a rule states no preference: every path is allowed.' },
        });
    }
    for (const [kind, lines] of /** @type {const} */ ([['Content-Usage', ai.content_usage], ['Content-Signal', ai.content_signal]])) {
      lines.forEach((line, index) => {
        const selector = `${kind.toLowerCase()}[${index}]`;
        if (line.valid) {
          results.push({ status: 'pass', url, selector });
          return;
        }
        results.push({
          status: 'fail', url, selector,
          evidence: {
            observed: { line: kind, value: line.value, problem: line.problem },
            expected: kind === 'Content-Usage' ? 'A usage preference such as "train-ai=n" (labels train-ai, ai-use, search; values y or n)' : 'name=value pairs such as "search=yes, ai-train=no"',
            detail: kind === 'Content-Usage' ? 'IETF aipref drafts (attach-05, vocab-08); no vendor was found to say it reads this line yet.' : 'Cloudflare\'s Content Signals; no AI vendor was found to say it reads this line yet.',
          },
        });
      });
    }
    return results;
  },
};

/** @type {CheckDef} */
const preferenceOverridden = {
  ...AI,
  id: 'ai.robots.shared_preference_overridden',
  title: 'A vendor\'s own robots.txt group overrides the shared no-training preference',
  description:
    'When a "User-Agent: __usage_ai-training" group disallows the start page, checks the vendors that document which rule wins: Anthropic follows a rule that names ClaudeBot over the shared preference, and Google reads the shared preference as a Google-Extended block only when Google-Extended is not named. A group of their own that allows the start page therefore keeps training on for that vendor. Information only.',
  severity: 'info',
  weight: 0,
  impact: 2,
  effort: 1,
  confidence: 'confirmed',
  scope: 'site',
  requires: ['ai_robots'],
  doc_ref: DOCS.ANTHROPIC_BOTS,
  recommendation: 'If training is to be refused for every vendor, disallow the start page in the ClaudeBot and Google-Extended groups too, or remove those groups.',
  run(ctx) {
    const ai = ctx.crawl.ai_robots;
    if (!ai || ai.policy.allowed !== false) return [];
    const url = startUrlOf(ctx);
    return ['ClaudeBot', 'Google-Extended'].flatMap((token) => {
      const bot = botByToken(token);
      const agent = ai.agents[token];
      if (!bot?.verified || agent === undefined) return [];
      const own = agent.group === 'own' || agent.group === 'named';
      if (!own || !agent.allowed) return [/** @type {CheckResult} */ ({ status: 'pass', url, selector: token })];
      return [{
        status: 'fail', url, selector: token,
        evidence: {
          observed: { crawler: token, own_group_allows: true, shared_preference: 'disallow', source: token === 'ClaudeBot' ? DOCS.ANTHROPIC_BOTS : DOCS.GOOGLE_AI_TRAINING_BLOG },
          expected: 'Information only',
          detail: token === 'ClaudeBot'
            ? 'Anthropic follows a robots.txt rule that names ClaudeBot even when the shared preference says something else.'
            : 'Google plans to read the shared preference as a Google-Extended block only when Google-Extended is not named, from early 2027.',
          limit: ROBOTS_ONLY,
        },
      }];
    });
  },
};

/** @type {CheckDef} */
const legacyDirective = {
  ...AI,
  id: 'ai.bing.legacy_ai_directive',
  title: 'The page relies on noarchive or nocache, which Bing stops reading for AI on 2027-03-01',
  description:
    'Lists each indexable page with noarchive or nocache in the robots meta tag, the bingbot meta tag or the X-Robots-Tag header and no ai-training or ai-grounding directive. Bing has read these as training and grounding preferences; after 2027-03-01 it no longer does, and its new directives (effective 2027-02-01) replace them. Information only.',
  severity: 'info',
  weight: 0,
  impact: 2,
  effort: 1,
  confidence: 'confirmed',
  scope: 'page',
  requires: ['ai_pages'],
  doc_ref: DOCS.BING_AI_PREFS,
  recommendation: 'Before 2027-03-01, state the preference in Bing\'s new form: training in robots.txt ("User-Agent: __usage_ai-training" with "Disallow: /") or per page (<meta name="Bingbot" content="ai-training:disallow">), grounding per page (content="ai-grounding:disallow"), and record the temporary grounding preference in Bing Webmaster Tools.',
  run(ctx) {
    return ctx.indexablePages.flatMap((page) => {
      if (!page.ai) return [];
      const legacy = page.ai.bingbot.filter((token) => token === 'noarchive' || token === 'nocache');
      if (legacy.length === 0) return [];
      const directives = bingAiDirectives(page);
      if (directives.training !== null || directives.grounding !== null) return [];
      return [{
        status: /** @type {const} */ ('fail'), url: page.url,
        evidence: {
          observed: { directives: [...new Set(legacy)].sort() },
          expected: 'Information only',
          detail: 'Bing: from 2027-02-01 it honours ai-training and ai-grounding preferences; after 2027-03-01 NoArchive and NoCache are no longer read as a preference for training or grounding.',
        },
      }];
    });
  },
};

/** @type {CheckDef} */
const groundingRestricted = {
  ...AI,
  id: 'ai.bing.grounding_restricted',
  title: 'The page tells Bing not to ground AI answers in it',
  description:
    'Lists each indexable page whose bingbot meta tag or X-Robots-Tag header gives ai-grounding:disallow (no grounding) or ai-grounding:disallowextended (grounding only in Microsoft\'s own AI experiences). Bing honours them from 2027-02-01 and says they reduce the site\'s visibility in AI answers without changing Bing search results. Not a unit when the site profile states that the site blocks AI crawlers. Information only.',
  severity: 'info',
  weight: 0,
  impact: 2,
  effort: 1,
  confidence: 'confirmed',
  scope: 'page',
  requires: ['ai_pages'],
  doc_ref: DOCS.BING_AI_PREFS,
  recommendation: 'Check that keeping this page out of Bing\'s and Copilot\'s AI answers is intended; remove the directive otherwise.',
  run(ctx) {
    if (searchBlockIntended(ctx)) return [];
    return ctx.indexablePages.flatMap((page) => {
      const grounding = bingAiDirectives(page).grounding;
      if (grounding !== 'disallow' && grounding !== 'disallowextended') return [];
      return [{
        status: /** @type {const} */ ('fail'), url: page.url,
        evidence: {
          observed: { directive: `ai-grounding:${grounding}`, policy: policyOf(ctx) },
          expected: 'Information only',
          detail: 'Bing: Disallow keeps the page out of grounding; DisallowExtended limits grounding to Microsoft-operated experiences. Bing search results are not affected.',
        },
      }];
    });
  },
};

export const trainingChecks = [preferenceInvalid, preferenceOverridden, legacyDirective, groundingRestricted];
