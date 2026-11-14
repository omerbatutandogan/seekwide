// JSON-LD blocks: validity and the schema.org types they declare. Pure.

/** @import { JsonLdBlock, ProfileEntity, VideoObjectSummary } from '../types.js' */

import { LIMITS } from '../config.js';
import { clip } from '../util/strings.js';

const MAX_TYPES = 50;
/** `VideoObject`s recorded per block, and how far and how wide the search for them goes. */
const MAX_VIDEOS = 20;
const MAX_PROFILES = 20;
const MAX_DEPTH = 16;
const MAX_NODES = 10_000;
/**
 * schema.org types that describe who is behind a site, whose `sameAs` names its profiles elsewhere: `Organization` and
 * its kinds (any type whose name ends in "Organization"), `LocalBusiness` and `OnlineBusiness` and theirs (ending in
 * "Business"), a few kinds with other names, and `Person`.
 */
const PROFILE_TYPE = /(?:^|[:/])(?:[A-Za-z]*Organization|[A-Za-z]*Business|Corporation|NGO|OnlineStore|Store|Restaurant|Airline|Consortium|Person)$/;

/**
 * @param {unknown} value
 * @param {string[]} types
 */
function addTypes(value, types) {
  const values = Array.isArray(value) ? value : [value];
  for (const type of values) {
    if (typeof type !== 'string' || type.trim() === '' || types.length >= MAX_TYPES) continue;
    const clipped = clip(type.trim(), LIMITS.maxStringLength);
    if (!types.includes(clipped)) types.push(clipped);
  }
}

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** @param {unknown} value @returns {boolean} A non-empty string. */
const filled = (value) => typeof value === 'string' && value.trim() !== '';

/**
 * True when a `@type` value names schema.org's `VideoObject`, also as `schema:VideoObject` or a full URL.
 * @param {unknown} type
 */
function isVideoType(type) {
  const values = Array.isArray(type) ? type : [type];
  return values.some((value) => typeof value === 'string' && /(?:^|[:/])VideoObject$/.test(value.trim()));
}

/**
 * Whether a `thumbnailUrl` value gives a thumbnail: a non-empty string, an
 * array with one, or an object with a `url` or `contentUrl`.
 * @param {unknown} value
 */
function hasThumbnail(value) {
  const values = Array.isArray(value) ? value : [value];
  return values.some((item) => filled(item) || (isObject(item) && (filled(item.url) || filled(item.contentUrl))));
}

/**
 * Every `VideoObject` anywhere in parsed JSON-LD, in document order, with
 * which of Google's required properties it has. The search is iterative and
 * stops at `MAX_DEPTH` levels and `MAX_NODES` values.
 * @param {unknown} data
 * @returns {VideoObjectSummary[]}
 */
function videoObjects(data) {
  /** @type {VideoObjectSummary[]} */
  const videos = [];
  for (const value of objectsIn(data)) {
    if (videos.length >= MAX_VIDEOS) break;
    if (isVideoType(value['@type'])) {
      videos.push({ name: filled(value.name), thumbnail_url: hasThumbnail(value.thumbnailUrl), upload_date: filled(value.uploadDate) });
    }
  }
  return videos;
}

/**
 * Every object anywhere in parsed JSON-LD, in document order. The walk is
 * iterative and stops at `MAX_DEPTH` levels and `MAX_NODES` values.
 * @param {unknown} data
 * @returns {Generator<Record<string, unknown>>}
 */
function* objectsIn(data) {
  /** @type {{value: unknown, depth: number}[]} */
  const stack = [{ value: data, depth: 0 }];
  for (let seen = 0; stack.length > 0 && seen < MAX_NODES; seen += 1) {
    const { value, depth } = /** @type {{value: unknown, depth: number}} */ (stack.pop());
    if (depth > MAX_DEPTH || (typeof value !== 'object' || value === null)) continue;
    const children = Array.isArray(value) ? value : Object.values(value);
    if (isObject(value)) yield value;
    for (let i = children.length - 1; i >= 0; i -= 1) {
      if (typeof children[i] === 'object' && children[i] !== null) stack.push({ value: children[i], depth: depth + 1 });
    }
  }
}

/**
 * Every Organization, business or Person at the top level of parsed JSON-LD
 * (the object, each object of a top-level array, and the objects in their
 * `@graph`), in document order, with how many non-empty `sameAs` URLs it gives
 * (a string or an array of them). An author or publisher nested inside another
 * object describes someone else, so it is not read. At most `MAX_PROFILES`.
 * @param {unknown} data
 * @returns {ProfileEntity[]}
 */
function profileEntities(data) {
  /** @type {ProfileEntity[]} */
  const profiles = [];
  /** @type {Record<string, unknown>[]} */
  const nodes = [];
  for (const item of Array.isArray(data) ? data : [data]) {
    if (!isObject(item)) continue;
    nodes.push(item);
    const graph = item['@graph'];
    for (const node of Array.isArray(graph) ? graph : [graph]) if (isObject(node)) nodes.push(node);
  }
  for (const value of nodes) {
    if (profiles.length >= MAX_PROFILES) break;
    const type = (Array.isArray(value['@type']) ? value['@type'] : [value['@type']])
      .find((item) => typeof item === 'string' && PROFILE_TYPE.test(item.trim()));
    if (typeof type !== 'string') continue;
    const sameAs = Array.isArray(value.sameAs) ? value.sameAs : [value.sameAs];
    profiles.push({ type: clip(type.trim(), LIMITS.maxStringLength), same_as: sameAs.filter(filled).length });
  }
  return profiles;
}

/**
 * Parse the text of one `<script type="application/ld+json">`.
 * `types` holds `@type` values of the top-level object (or of each object in a
 * top-level array) and of the objects in their `@graph`, in order, once each.
 * `videos` holds every `VideoObject` in the block, at any depth, and
 * `profiles` every Organization, business or Person at the top level and in `@graph`, with its `sameAs` count.
 * Empty content is not valid JSON and is reported as such.
 * @param {string} text
 * @param {number|null} line
 * @returns {JsonLdBlock}
 */
export function parseJsonLd(text, line) {
  /** @type {unknown} */
  let data;
  try {
    data = JSON.parse(text);
  } catch (error) {
    const message = text.trim() === '' ? 'Empty JSON-LD script' : /** @type {Error} */ (error).message;
    return { valid: false, types: [], error: clip(message, LIMITS.maxStringLength), line, videos: [], profiles: [] };
  }
  /** @type {string[]} */
  const types = [];
  for (const item of Array.isArray(data) ? data : [data]) {
    if (!isObject(item)) continue;
    addTypes(item['@type'], types);
    const graph = item['@graph'];
    for (const node of Array.isArray(graph) ? graph : [graph]) {
      if (isObject(node)) addTypes(node['@type'], types);
    }
  }
  return { valid: true, types, error: null, line, videos: videoObjects(data), profiles: profileEntities(data) };
}
