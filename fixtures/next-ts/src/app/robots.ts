import type { MetadataRoute } from 'next';

// Deliberate problem: no sitemap line, and the project has no sitemap.
export default function robots(): MetadataRoute.Robots {
  return { rules: [{ userAgent: '*', allow: '/' }] };
}
