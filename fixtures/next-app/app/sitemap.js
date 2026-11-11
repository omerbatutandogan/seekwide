const SITE = 'http://localhost:3000';

// Deliberate problem: /blog/missing-post answers 404.
export default function sitemap() {
  return ['/', '/about', '/pricing', '/blog', '/blog/first-post', '/blog/second-post', '/blog/missing-post', '/docs'].map((path) => ({
    url: `${SITE}${path}`,
  }));
}
