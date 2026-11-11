// Seekwide reads the HTML the server sends and does not run JavaScript. This
// tells Next.js so: it then sends each page's metadata in <head> instead of
// appending it to <body> ("streaming metadata").
// https://nextjs.org/docs/app/api-reference/functions/generate-metadata#streaming-metadata
const nextConfig = {
  htmlLimitedBots: /seekwide/i,
};

export default nextConfig;
