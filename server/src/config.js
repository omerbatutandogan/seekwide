import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const pkg = JSON.parse(readFileSync(path.join(PLUGIN_ROOT, 'package.json'), 'utf8'));

/** Plugin version, read from package.json. */
export const VERSION = /** @type {string} */ (pkg.version);

/** Version of the rule set. Bump it whenever a check changes what it reports. */
export const RULES_VERSION = '0.1.4';

/** Version of the JSON written under `.seekwide/`. */
export const SCHEMA_VERSION = 1;

/** Product token matched against robots.txt `User-agent` lines. */
export const PRODUCT_TOKEN = 'seekwide';

export const HOMEPAGE = /** @type {string} */ (pkg.homepage);

/** The crawler always identifies itself; it never pretends to be a browser or another bot. */
export const USER_AGENT = `${PRODUCT_TOKEN}/${VERSION} (+${HOMEPAGE})`;

export const LIMITS = Object.freeze({
  maxPagesDefault: 25,
  maxPagesHardCap: 500,
  requestTimeoutMs: 15_000,
  maxBodyBytes: 5 * 1024 * 1024,
  // Googlebot follows up to 10 redirect hops, so a chain is only called broken beyond that.
  maxRedirects: 10,
  ratePerSecDefault: 1,
  ratePerSecMax: 2,
  crawlDelayMaxSec: 10,
  // A crawl that is still going after this long stops as truncated. 500 pages at
  // one request a second take about 9 minutes; a long crawl-delay can make it hours.
  crawlMaxMs: 30 * 60_000,
  maxSitemapFiles: 5,
  maxSitemapUrls: 5000,
  maxOutboundChecks: 50,
  outboundConcurrency: 4,
  textExcerptChars: 2000,
  maxStringLength: 300,
  maxRelatedUrls: 20,
  // Core Web Vitals. A PageSpeed Insights test loads the page in a real browser
  // at Google and takes many seconds, so only a few pages are tested.
  vitalsPagesDefault: 3,
  vitalsPagesMax: 10,
  psiTimeoutMs: 60_000,
  psiConcurrency: 3,
  // A PageSpeed Insights answer carries screenshots and is far larger than a page.
  psiMaxBodyBytes: 16 * 1024 * 1024,
  // No new PageSpeed Insights test starts once this much time has passed.
  vitalsDeadlineMs: 90_000,
});

export const MODULES = Object.freeze(['seo', 'links', 'security']);

export const SEVERITIES = Object.freeze(['critical', 'high', 'medium', 'low', 'info']);

/**
 * Things a check may require before it can run. The engine skips checks whose requirements are not met.
 * The crawl provides the first three, the external link check `outbound`, and the Core Web Vitals
 * measurement `lab_data` and `field_data`. `live_site` is provided for a crawl of a site that is not on
 * this machine: the response headers of a local development server say nothing about the deployed site.
 */
export const CAPABILITIES = Object.freeze(['full_crawl', 'sitemap', 'robots', 'outbound', 'lab_data', 'field_data', 'live_site']);

/** An API key is sent in a request header, so it must be printable ASCII without spaces. */
const API_KEY_PATTERN = /^[\x21-\x7E]{1,256}$/;

/**
 * The Google API key from the plugin settings, or null when none is set.
 * Blank values, an unsubstituted placeholder such as "${user_config.google_api_key}"
 * and values that could not be sent in a header all count as not set.
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string|null}
 */
export function googleApiKey(env = process.env) {
  return googleApiKeySetting(env).key;
}

/**
 * What the plugin settings hold for the Google API key: the key, nothing, or
 * a value that is set but cannot be used, because no request header can carry
 * it (a space or a line break inside, a character outside printable ASCII, or
 * more than 256 characters). Blank values and an unsubstituted placeholder
 * count as nothing.
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {{key: string|null, unusable: boolean}}  `unusable` is true only when a value is set and `key` is null.
 */
export function googleApiKeySetting(env = process.env) {
  const value = (env.SEEKWIDE_GOOGLE_API_KEY ?? '').trim();
  if (value === '' || value.includes('${')) return { key: null, unusable: false };
  return API_KEY_PATTERN.test(value) ? { key: value, unusable: false } : { key: null, unusable: true };
}

/**
 * The settings the tools read from the environment: the report brand and logo.
 * Nothing else is handed on, so a secret in the server's environment, such as
 * the Google API key, cannot reach a tool or its result.
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {{SEEKWIDE_REPORT_BRAND?: string, SEEKWIDE_REPORT_LOGO?: string}}
 */
export function toolSettings(env = process.env) {
  return { SEEKWIDE_REPORT_BRAND: env.SEEKWIDE_REPORT_BRAND, SEEKWIDE_REPORT_LOGO: env.SEEKWIDE_REPORT_LOGO };
}

/**
 * Directory for caches that may be deleted at any time (crawl results).
 * Claude Code passes `CLAUDE_PLUGIN_DATA`; outside Claude Code a per-user cache directory is used.
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string}
 */
export function dataDir(env = process.env) {
  for (const candidate of [env.SEEKWIDE_DATA_DIR, env.CLAUDE_PLUGIN_DATA]) {
    // An unsubstituted placeholder such as "${CLAUDE_PLUGIN_DATA}" means the variable was not set.
    if (candidate && !candidate.includes('${')) return candidate;
  }
  return path.join(os.homedir(), '.cache', 'seekwide');
}

/**
 * Directory that receives `.seekwide/` when a tool call does not name one.
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string}
 */
export function defaultProjectDir(env = process.env) {
  const fromEnv = env.CLAUDE_PROJECT_DIR;
  if (fromEnv && !fromEnv.includes('${')) return fromEnv;
  return process.cwd();
}
