// The scope section of a report and the facts about the crawl it rests on.
// Pure: depends only on the stored run.

/** @import { Run } from '../types.js' */

import { MODULES } from '../config.js';
import { clip } from '../util/strings.js';
import { ROBOTS_STATUS } from './copy.js';
import { describeBlock, describeUnreadable, moduleLabel, plural } from './facts.js';
import { compareText, num, obj, str, text } from './values.js';

/**
 * Module keys in the order the plugin lists them, then any others alphabetically.
 * @param {string[]} names
 * @returns {string[]}
 */
export function orderModules(names) {
  const rank = (/** @type {string} */ name) => (MODULES.includes(name) ? MODULES.indexOf(name) : MODULES.length);
  return [...names].sort((a, b) => rank(a) - rank(b) || compareText(a, b));
}

/**
 * Pages the crawler was refused on. Runs stored before this was counted have none.
 * @param {Run} run
 * @returns {number}
 */
export function unreadablePages(run) {
  return Math.max(0, Math.floor(num(obj(run.crawl).unreadable_pages)));
}

export const REPO_FRAMEWORKS = ['next-app', 'html'];

/**
 * The scope row on source files, or null when the run was not a repo-mode audit.
 * @param {Run} run
 * @param {number} findings
 * @returns {{label: string, value: string, code?: boolean}|null}
 */
function viewRepo(run, findings) {
  if (run.repo === null || typeof run.repo !== 'object' || Array.isArray(run.repo)) return null;
  const repo = obj(run.repo);
  const label = text(repo.label, 'Unnamed').slice(0, 80);
  if (!REPO_FRAMEWORKS.includes(str(repo.framework))) {
    return { label: 'Source files', value: `Not named. The project in this folder (${label}) is not supported for source mapping yet.` };
  }
  const dir = text(repo.source_dir);
  const where = dir === '' || dir === '.' ? '' : ` in ${clip(dir, 200)}`;
  const named = Math.min(findings, Math.max(0, Math.floor(num(repo.findings_with_source))));
  const deployed = text(repo.deployed_origin);
  return {
    label: 'Source files',
    value: `${label} project${where}. ${named} of ${plural(findings, 'finding')} ${findings === 1 ? 'names' : 'name'} the source file ${findings === 1 ? 'it comes' : 'they come'} from. Paths are relative to the project folder.` +
      (deployed === '' ? '' : num(repo.deployed_localized) > 0
        ? ` Canonical links, links and sitemap entries that name the deployed address (${clip(deployed, 200)}) were read as pages of the local server.`
        : ` The deployed address given for this audit (${clip(deployed, 200)}) matched no canonical link, link or sitemap entry of the pages, so none was read as a page of the local server.`),
  };
}

/**
 * The scope row on image files, or null when the run did not check them.
 * @param {Run} run
 * @returns {{label: string, value: string, code?: boolean}|null}
 */
function viewImageFiles(run) {
  if (run.image_files === null || typeof run.image_files !== 'object' || Array.isArray(run.image_files)) return null;
  const files = obj(run.image_files);
  const images = Math.max(0, Math.floor(num(files.images)));
  const selected = Math.min(images, Math.max(0, Math.floor(num(files.selected))));
  if (images === 0) return { label: 'Image files', value: 'The crawled pages show no image file to check.' };
  const outcomes = obj(files.outcomes);
  const answered = Math.min(selected, Math.max(0, Math.floor(num(outcomes.ok))) + Math.max(0, Math.floor(num(outcomes.broken))));
  const local = files.local === true ? ' Only images on the address of this site on your machine were requested.' : '';
  const skipped = files.site_skipped === true ? " The site refused some of the crawler's page requests, so no image on its own host was requested." : '';
  return {
    label: 'Image files',
    value: `${selected} of ${plural(images, 'distinct image')} chosen to check (robots.txt first, then a HEAD request each); ${answered} answered.${local}${skipped}`,
  };
}

/**
 * The scope rows of the smo and aso modules and of what no check requested by
 * rule, each only when the run has it.
 * @param {Run} run
 * @returns {{label: string, value: string, code?: boolean}[]}
 */
function viewSharing(run) {
  /** @type {{label: string, value: string, code?: boolean}[]} */
  const rows = [];
  const social = run.social_images;
  if (social !== null && typeof social === 'object' && !Array.isArray(social)) {
    const files = obj(social);
    const images = Math.max(0, Math.floor(num(files.images)));
    const selected = Math.min(images, Math.max(0, Math.floor(num(files.selected))));
    const outcomes = obj(files.outcomes);
    const answered = Math.min(selected, Math.max(0, Math.floor(num(outcomes.ok))) + Math.max(0, Math.floor(num(outcomes.broken))));
    const sized = Math.min(answered, Math.max(0, Math.floor(num(files.sized))));
    rows.push({
      label: 'Sharing images',
      value: images === 0 ? 'The crawled pages give no sharing image (og:image or twitter:image).'
        : `${selected} of ${plural(images, 'distinct sharing image')} checked (robots.txt first, then one GET of at most 64 KiB each); ${answered} answered, and the pixel size of ${sized} was read from the file.`,
    });
  }
  const apps = run.app_files;
  if (apps !== null && typeof apps === 'object' && !Array.isArray(apps)) {
    /** @param {unknown} file */
    const said = (file) => ({ answered: 'served', not_found: 'not found', unverifiable: 'could not be verified', disallowed: 'not requested, robots.txt disallows it' })[str(obj(file).outcome)] ?? 'unknown';
    rows.push({ label: 'App association files', value: `apple-app-site-association: ${said(obj(apps).aasa)}. assetlinks.json: ${said(obj(apps).assetlinks)}.` });
  }
  const skipped = run.not_requested;
  if (skipped !== null && typeof skipped === 'object' && !Array.isArray(skipped)) {
    const counts = obj(skipped);
    const parts = [
      [num(counts.links), 'external link'], [num(counts.images), 'image file'], [num(counts.social_images), 'sharing image'],
    ].filter(([count]) => /** @type {number} */ (count) > 0).map(([count, noun]) => plural(Math.floor(/** @type {number} */ (count)), /** @type {string} */ (noun)));
    const hosts = Array.isArray(counts.hosts) ? counts.hosts.filter((host) => typeof host === 'string').join(', ') : '';
    if (parts.length > 0) {
      rows.push({ label: 'Not checked, by rule', value: `${parts.join(', ')} on Google Play or social platforms${hosts === '' ? '' : ` (${hosts})`}. Seekwide never sends a request there.` });
    }
  }
  return rows;
}

/**
 * @param {Run} run
 * @param {{host: string, blocked: ReturnType<typeof viewBlock>}} derived
 */
export function viewScope(run, { host, blocked }) {
  const crawl = obj(run.crawl);
  const pages = num(crawl.pages_crawled);
  const sitemapUrls = num(crawl.sitemap_urls);
  const robots = str(crawl.robots_status);
  const unreadable = unreadablePages(run);
  const repo = viewRepo(run, Array.isArray(run.findings) ? run.findings.length : 0);
  const imageFiles = viewImageFiles(run);
  const modules = Array.isArray(run.modules_requested) ? orderModules(run.modules_requested.filter((m) => typeof m === 'string')).map(moduleLabel) : [];
  return [
    { label: 'Pages crawled', value: `${pages} of ${plural(num(crawl.max_pages), 'page')} allowed (${num(crawl.html_pages)} HTML, ${num(crawl.indexable_pages)} indexable)` },
    crawl.time_limit_reached === true
      ? { label: 'Time limit reached', value: 'Yes. The crawl stopped at its time limit before every URL it found was visited, so the findings describe the pages crawled only.' }
      : {
        label: 'Page limit reached',
        value: crawl.truncated === true
          ? 'Yes. The crawl stopped before every URL it found was visited, so the findings describe the pages crawled only.'
          : 'No. The crawl ran out of URLs before it ran out of budget.',
      },
    { label: 'Blocked', value: blocked ? describeBlock(blocked) : 'No.' },
    ...(unreadable > 0 ? [{ label: 'Pages not read', value: describeUnreadable(unreadable) }] : []),
    { label: 'robots.txt', value: Object.hasOwn(ROBOTS_STATUS, robots) ? ROBOTS_STATUS[/** @type {keyof typeof ROBOTS_STATUS} */ (robots)] : text(robots, 'Unknown.') },
    { label: 'Sitemap', value: sitemapUrls > 0 ? `${plural(sitemapUrls, 'URL')} listed in XML sitemaps.` : 'No URLs found in XML sitemaps.' },
    { label: 'Modules', value: modules.length > 0 ? modules.join(', ') : 'None recorded.' },
    ...(repo ? [repo] : []),
    ...(imageFiles ? [imageFiles] : []),
    ...viewSharing(run),
    { label: 'User agent', value: text(crawl.user_agent, 'Not recorded.'), code: true },
  ];
}

/**
 * @param {unknown} raw
 * @returns {{reason: string, url: string, status: number}|null}
 */
export function viewBlock(raw) {
  if (!raw) return null;
  const block = obj(raw);
  return { reason: str(block.reason), url: str(block.url), status: num(block.status) };
}

/**
 * What a run stored about its start page: the login or password page its URL
 * redirects to, and the words of a start page that holds almost nothing.
 * Runs stored before these were recorded have neither.
 * @param {Record<string, unknown>} crawl  `run.crawl`.
 * @returns {{startGate: string|null, startShellWords: number|null}}
 */
export function startFacts(crawl) {
  const gate = text(crawl.start_gate);
  const words = crawl.start_shell_words;
  return {
    startGate: gate === '' ? null : clip(gate, 300),
    startShellWords: Number.isInteger(words) && /** @type {number} */ (words) >= 0 ? /** @type {number} */ (words) : null,
  };
}
