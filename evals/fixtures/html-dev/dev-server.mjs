// Dev server for this site. A static file server serves the folder and writes
// the port it listens on to .dev-port; this script prints the address and
// keeps running until it is stopped.
import { readFileSync } from 'node:fs';

let port;
try {
  port = readFileSync(new URL('./.dev-port', import.meta.url), 'utf8').trim();
} catch {
  console.error('No static server is running: .dev-port is missing.');
  process.exit(1);
}
console.log(`Serving the site at http://127.0.0.1:${port}/`);
console.log('Press Ctrl+C to stop.');
setInterval(() => {}, 60_000);
