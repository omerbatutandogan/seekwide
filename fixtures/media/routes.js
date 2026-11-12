// A small synthetic site for the media module, served by test/helpers/http-server.js.
// Every page and image is made up; nothing is copied from a real site.

/**
 * An image the server describes with headers and never sends whole: HEAD gives
 * the type and size, and a ranged GET gets one byte with the total.
 * @param {string} type
 * @param {number} size
 * @returns {(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => void}
 */
function image(type, size) {
  return (req, res) => {
    if (req.method === 'GET' && req.headers.range === 'bytes=0-0') {
      res.writeHead(206, { 'content-type': type, 'content-range': `bytes 0-0/${size}`, 'content-length': '1' });
      res.end(Buffer.alloc(1));
      return;
    }
    res.writeHead(200, { 'content-type': type, 'content-length': String(size) });
    res.end(req.method === 'HEAD' ? undefined : Buffer.alloc(size));
  };
}

/**
 * @param {string} title
 * @param {string} body
 * @param {string} [head]
 */
function page(title, body, head = '') {
  return {
    headers: { 'content-type': 'text/html; charset=utf-8' },
    body: `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title>`
      + `<meta name="viewport" content="width=device-width, initial-scale=1">${head}</head>`
      + `<body><nav><a href="/">Home</a> <a href="/gallery">Gallery</a> <a href="/talk">Talk</a> <a href="/clean">Clean</a></nav>`
      + `<main><h1>${title}</h1>${body}</main></body></html>`,
  };
}

const VIDEO_DATA = (/** @type {Record<string, string>} */ fields) => `<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@type': 'VideoObject', ...fields })}</script>`;

export const mediaRoutes = {
  '/robots.txt': {
    headers: { 'content-type': 'text/plain' },
    body: 'User-agent: *\nAllow: /\n\nUser-agent: Googlebot-Image\nDisallow: /private-img/\n',
  },
  '/': page('Acme Garden', [
    '<img src="/img/logo.png" alt="Acme Garden" width="200" height="80">',
    '<img src="/img/hero.webp" alt="" width="1200" height="600" fetchpriority="high" loading="lazy">',
    '<img src="/img/missing.jpg" alt="Roses in bloom">',
    '<img src="https://cdn.test/remote.jpg" alt="A remote picture" width="10" height="10">',
    '<img src="/img/pixel.gif" width="1" height="1">',
  ].join('')),
  '/gallery': page('Gallery', [
    '<img src="/img/IMG_0423.jpg" alt="IMG_0423" width="400" height="300">',
    '<img src="/private-img/plan.png" width="1600" height="1200">',
    '<img src="/img/hero.webp" alt="The garden at dawn" width="1200" height="600">',
  ].join('')),
  '/talk': page('A talk about roses', [
    '<video controls src="/media/talk.mp4"><track kind="subtitles" srclang="en" src="/media/talk.vtt"></video>',
    '<iframe src="https://www.youtube-nocookie.com/embed/abc123" title="Pruning roses"></iframe>',
  ].join(''), VIDEO_DATA({ name: 'A talk about roses', thumbnailUrl: 'https://example.test/t.jpg' })),
  '/clean': page('Planting tulips', [
    '<video controls src="/media/tulips.mp4"><track kind="captions" srclang="en" src="/media/tulips.vtt"></video>',
    '<video autoplay muted loop playsinline src="/media/background.mp4"></video>',
    '<picture><source type="image/webp" srcset="/img/tulips.webp"><img src="/img/tulips.jpg" alt="Tulips in a row" width="800" height="600"></picture>',
  ].join(''), VIDEO_DATA({ name: 'Planting tulips', thumbnailUrl: 'https://example.test/tulips.jpg', uploadDate: '2026-04-01T09:00:00+02:00' })),
  '/img/logo.png': image('image/png', 50_000),
  '/img/hero.webp': image('image/webp', 90_000),
  '/img/IMG_0423.jpg': image('image/jpeg', 20_000),
  '/private-img/plan.png': image('image/png', 700_000),
  '/img/tulips.jpg': image('image/jpeg', 120_000),
  '/img/pixel.gif': image('image/gif', 43),
};
