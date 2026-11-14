// A small synthetic site for the ai module, served by
// test/helpers/http-server.js. Every page is made up. `{origin}` is the
// server's own address. What each page was built to have:
//
//   robots.txt   blocks PerplexityBot, Applebot (no Applebot-Extended), GPTBot and ChatGPT-User; keeps OAI-SearchBot out of
//                /private-docs/; states a shared no-training preference that ClaudeBot's own group overrides; one valid
//                Content-Signal line and one Content-Usage line with a value the vocabulary does not have.
//   /            content, a sitemap of every page, and noarchive for bingbot (Bing's legacy AI preference)
//   /nosnippet   nosnippet in the robots meta tag
//   /limited     max-snippet:50
//   /hidden-main the h1 and most of the text inside data-nosnippet
//   /app         an empty #root and a script: the content comes from scripts
//   /grounding   X-Robots-Tag: bingbot: ai-grounding:disallow
//   /private-docs/guide  a page OAI-SearchBot may not read
//   /llms.txt    text before its "# " title line

const WORDS = 'Seekwide fixture pages describe a small bakery that sells bread, cakes and coffee in a quiet street. ' +
  'The shop opens early every morning, bakes sourdough loaves by hand, and delivers orders to offices nearby. ' +
  'Customers can read about the ingredients, the bakers, opening hours and seasonal specials on these pages.';

/**
 * @param {string} path
 * @param {string} title
 * @param {string} body
 * @param {string} [head]
 * @param {Record<string, string>} [headers]
 */
function page(path, title, body, head = '', headers = {}) {
  return {
    headers: { 'content-type': 'text/html; charset=utf-8', ...headers },
    body: `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title><meta name="description" content="${title} of the fixture bakery."><link rel="canonical" href="{origin}${path}">${head}</head><body>${body}</body></html>`,
  };
}

const LINKS = '<nav><a href="/">Home</a> <a href="/nosnippet">Nosnippet</a> <a href="/limited">Limited</a> <a href="/hidden-main">Hidden main</a> <a href="/app">App</a> <a href="/grounding">Grounding</a> <a href="/private-docs/guide">Guide</a></nav>';

/** @type {Record<string, import('../../test/helpers/http-server.js').RouteHandler>} */
export const aiRoutes = {
  '/robots.txt': {
    headers: { 'content-type': 'text/plain' },
    body: [
      'User-agent: *',
      'Allow: /',
      'Content-Signal: search=yes, ai-train=no',
      'Content-Usage: train-ai=maybe',
      '',
      'User-agent: GPTBot',
      'User-agent: PerplexityBot',
      'User-agent: ChatGPT-User',
      'Disallow: /',
      '',
      'User-agent: OAI-SearchBot',
      'Disallow: /private-docs/',
      '',
      'User-agent: Applebot',
      'Disallow: /',
      '',
      'User-agent: ClaudeBot',
      'Allow: /',
      '',
      'User-Agent: __usage_ai-training',
      'Disallow: /',
      '',
      'Sitemap: {origin}/sitemap.xml',
      '',
    ].join('\n'),
  },
  '/sitemap.xml': {
    headers: { 'content-type': 'application/xml' },
    body: `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${['/', '/nosnippet', '/limited', '/hidden-main', '/app', '/grounding', '/private-docs/guide'].map((path) => `<url><loc>{origin}${path === '/' ? '/' : path}</loc></url>`).join('')}</urlset>`,
  },
  '/': page('/', 'Home', `${LINKS}<main><h1>Fixture bakery</h1><p>${WORDS}</p></main>`, '<meta name="bingbot" content="noarchive">'),
  '/nosnippet': page('/nosnippet', 'Nosnippet', `${LINKS}<main><h1>No snippet</h1><p>${WORDS}</p></main>`, '<meta name="robots" content="nosnippet">'),
  '/limited': page('/limited', 'Limited', `${LINKS}<main><h1>Limited snippet</h1><p>${WORDS}</p></main>`, '<meta name="robots" content="max-snippet:50">'),
  '/hidden-main': page('/hidden-main', 'Hidden main', `${LINKS}<main><div data-nosnippet><h1>Hidden main text</h1><p>${WORDS} ${WORDS}</p></div></main><footer><p>Contact us.</p></footer>`),
  '/app': page('/app', 'App', '<div id="root"></div><script src="/app.js"></script>'),
  '/grounding': page('/grounding', 'Grounding', `${LINKS}<main><h1>Grounding</h1><p>${WORDS}</p></main>`, '', { 'x-robots-tag': 'bingbot: ai-grounding:disallow' }),
  '/private-docs/guide': page('/private-docs/guide', 'Guide', `${LINKS}<main><h1>Guide</h1><p>${WORDS}</p></main>`),
  '/llms.txt': {
    headers: { 'content-type': 'text/plain; charset=utf-8' },
    body: 'Fixture bakery, plain text first.\n\n# Fixture bakery\n\n> A made-up bakery.\n\n## Pages\n\n- [Home]({origin}/): the start page\n',
  },
};
