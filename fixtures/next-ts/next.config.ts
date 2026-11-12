import type { NextConfig } from 'next';

// Seekwide reads the HTML the server sends and does not run JavaScript. This
// tells Next.js so: it then sends each page's metadata in <head> instead of
// appending it to <body> ("streaming metadata").
const nextConfig: NextConfig = {
  htmlLimitedBots: /seekwide/i,
};

export default nextConfig;
