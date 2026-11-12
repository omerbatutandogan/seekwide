// Seekwide reads the HTML the server sends and does not run JavaScript, so
// Next.js is told to send metadata in <head> to it. The shared UI package is
// plain JSX and is compiled by Next.js.
const nextConfig = {
  htmlLimitedBots: /seekwide/i,
  transpilePackages: ['@seekwide-fixture/ui'],
};

export default nextConfig;
