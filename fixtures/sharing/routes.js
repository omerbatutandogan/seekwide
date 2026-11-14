// A small synthetic site for the smo and aso modules, served by
// test/helpers/http-server.js. Every page and image is made up; nothing is
// copied from a real site. `{origin}` is the server's own address.

/**
 * A PNG of the given size that the server sends only as its first bytes: a
 * ranged GET gets the signature and the IHDR chunk with the total size.
 * @param {number} width
 * @param {number} height
 * @param {number} total  The size the server says the whole file has.
 * @returns {(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => void}
 */
function png(width, height, total) {
  const head = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(head, 0);
  head.writeUInt32BE(13, 8);
  head.write('IHDR', 12, 'ascii');
  head.writeUInt32BE(width, 16);
  head.writeUInt32BE(height, 20);
  return (req, res) => {
    if (req.method === 'GET' && /^bytes=0-\d+$/.test(req.headers.range ?? '')) {
      res.writeHead(206, { 'content-type': 'image/png', 'content-range': `bytes 0-${head.length - 1}/${total}`, 'content-length': String(head.length) });
      res.end(head);
      return;
    }
    res.writeHead(200, { 'content-type': 'image/png', 'content-length': String(total) });
    res.end(req.method === 'HEAD' ? undefined : Buffer.alloc(total));
  };
}

/**
 * @param {string} head  What goes in the <head> besides the title.
 * @param {string} body
 */
function page(head, body = '<h1>Page</h1><p>Text.</p>') {
  return {
    headers: { 'content-type': 'text/html; charset=utf-8' },
    body: `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Sharing site</title><meta name="viewport" content="width=device-width">${head}</head><body>${body}</body></html>`,
  };
}

/** @param {string} path @param {string} image */
const og = (path, image) => [
  '<meta property="og:title" content="A page">', '<meta property="og:type" content="website">', `<meta property="og:url" content="{origin}${path}">`,
  '<meta property="og:description" content="What the page is about.">', `<meta property="og:image" content="${image}">`,
  '<meta property="og:image:width" content="1200">', '<meta property="og:image:height" content="630">', '<meta property="og:image:alt" content="A drawing">',
  `<link rel="canonical" href="{origin}${path}">`,
].join('');

const LINKS = [
  '<a href="/good">Good</a>', '<a href="/small">Small image</a>', '<a href="/social">Image on a social platform</a>',
  '<a href="/banner">App</a>', '<a href="/late">Late head</a>', '<a href="/body-og">Body tags</a>',
  '<a href="https://www.facebook.com/acme">Facebook</a>', '<a href="https://play.google.com/store/apps/details?id=com.example">Google Play</a>',
  '<a href="https://mastodon.example/@acme">Mastodon</a>',
].join(' ');

/** @type {Record<string, unknown>} */
export const sharingRoutes = {
  // Meta's preview crawler is kept out; the audit's own crawler is not.
  '/robots.txt': { headers: { 'content-type': 'text/plain' }, body: 'User-agent: facebookexternalhit\nDisallow: /\n\nUser-agent: *\nAllow: /\n' },
  '/': page(`${og('/', '/img/share.png')}<script type="application/ld+json">{"@context":"https://schema.org","@type":"Organization","name":"Acme"}</script>`, `<h1>Home</h1><p>${LINKS}</p>`),
  '/good': page(og('/good', '{origin}/img/share.png')),
  '/small': page(og('/small', '{origin}/img/small.png')),
  '/social': page(og('/social', 'https://scontent.xx.fbcdn.net/v/acme.jpg')),
  '/banner': page(`${og('/banner', '{origin}/img/share.png')}<meta name="apple-itunes-app" content="app-id=myAppStoreID">`),
  '/late': page(`${og('/late', '{origin}/img/share.png')}<script>var padding = "${'x'.repeat(310 * 1024)}";</script>`),
  '/body-og': page('<link rel="canonical" href="{origin}/body-og">', '<meta property="og:title" content="In the body"><meta property="og:image" content="{origin}/img/share.png"><p>Text.</p>'),
  '/img/share.png': png(1200, 630, 90_000),
  '/img/small.png': png(150, 150, 700_000),
};
