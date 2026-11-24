// JSON-LD blocks: validity and the schema.org types they declare. Pure.

/** @import { ArticleSummary, JsonLdBlock, LocalBusinessFields, ProfileEntity, VideoObjectSummary } from '../types.js' */

import { LIMITS } from '../config.js';
import { clip } from '../util/strings.js';
import { isLocalBusinessType } from '../util/local-business.js';

const MAX_TYPES = 50;
/** `VideoObject`s recorded per block, and how far and how wide the search for them goes. */
const MAX_VIDEOS = 20;
const MAX_PROFILES = 20;
const MAX_ARTICLES = 20;
/** The schema.org types Google's Article structured data is based on, also as `schema:BlogPosting` or a full URL. */
const ARTICLE_TYPE = /(?:^|[:/])(?:Article|NewsArticle|BlogPosting)$/;
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
 * The first non-empty string of a value that is a string or an array of them, trimmed and clipped, or null.
 * @param {unknown} value
 * @returns {string|null}
 */
function firstText(value) {
  const found = (Array.isArray(value) ? value : [value]).find(filled);
  return typeof found === 'string' ? clip(found.trim(), LIMITS.maxStringLength) : null;
}

/**
 * The address of the first image a `logo` value gives: a URL, an ImageObject with a `url` or `contentUrl`, or an array
 * of either. Null when it gives none.
 * @param {unknown} value
 * @returns {string|null}
 */
function firstImage(value) {
  for (const item of Array.isArray(value) ? value : [value]) {
    if (filled(item)) return firstText(item);
    if (isObject(item)) {
      const url = firstText(item.url) ?? firstText(item.contentUrl);
      if (url !== null) return url;
    }
  }
  return null;
}

/** The parts of a PostalAddress, in the order the record lists the ones given. */
const ADDRESS_PARTS = ['streetAddress', 'addressLocality', 'addressRegion', 'postalCode', 'addressCountry'];

/**
 * The digits after the decimal point of each number written for `key` in the block's text, by the value it parses to:
 * JSON.parse turns 41.10000 into 41.1, and Google counts the decimal places as written.
 * @param {string} text
 * @param {string} key
 * @returns {Map<number, number>}
 */
function writtenDecimals(text, key) {
  /** @type {Map<number, number>} */
  const found = new Map();
  const pattern = new RegExp(`"${key}"\\s*:\\s*"?(-?\\d{1,3}(?:\\.(\\d{1,20}))?)"?`, 'g');
  let count = 0;
  for (const match of text.matchAll(pattern)) {
    if ((count += 1) > MAX_PROFILES * 4) break;
    const value = Number(match[1]);
    const places = match[2]?.length ?? 0;
    if (!found.has(value) || /** @type {number} */ (found.get(value)) < places) found.set(value, places);
  }
  return found;
}

/**
 * A coordinate and how many decimal places it is written with, or null when the value is not a number or a numeric string.
 * @param {unknown} value
 * @param {Map<number, number>} written
 * @returns {{value: number, places: number}|null}
 */
function coordinate(value, written) {
  if (typeof value === 'string' && /^\s*-?\d{1,3}(?:\.\d+)?\s*$/.test(value)) {
    return { value: Number(value), places: value.trim().split('.')[1]?.length ?? 0 };
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const shortest = String(value).split('.')[1]?.length ?? 0;
  return { value, places: Math.max(shortest, written.get(value) ?? 0) };
}

/**
 * What Google's local business rules read of a LocalBusiness (rule set 0.2.3).
 * @param {Record<string, unknown>} value
 * @param {string} text  The block's JSON text, for the decimal places of the coordinates.
 * @returns {LocalBusinessFields}
 */
function localFields(value, text) {
  const address = Array.isArray(value.address) ? value.address.find((item) => filled(item) || isObject(item)) : value.address;
  const parts = isObject(address) ? ADDRESS_PARTS.filter((part) => firstText(address[part]) !== null || (isObject(address[part]) && firstText(address[part].name) !== null)) : [];
  const geo = Array.isArray(value.geo) ? value.geo.find(isObject) : value.geo;
  const hours = value.openingHoursSpecification;
  const price = (Array.isArray(value.priceRange) ? value.priceRange : [value.priceRange]).find(filled);
  return {
    address: filled(address) ? 'text' : parts.length > 0 ? 'parts' : null,
    address_parts: parts,
    address_text: filled(address) ? clip(String(address).replace(/\s+/g, ' ').trim(), LIMITS.maxStringLength)
      : parts.length > 0 ? clip(parts.map((part) => {
        const item = /** @type {Record<string, unknown>} */ (address)[part];
        return firstText(item) ?? (isObject(item) ? firstText(item.name) : null);
      }).join(', '), LIMITS.maxStringLength) : null,
    telephone: firstText(value.telephone),
    geo: isObject(geo) ? {
      latitude: coordinate(geo.latitude, writtenDecimals(text, 'latitude')),
      longitude: coordinate(geo.longitude, writtenDecimals(text, 'longitude')),
    } : null,
    hours_specification: isObject(hours) || (Array.isArray(hours) && hours.some(isObject)),
    hours_text: (Array.isArray(value.openingHours) ? value.openingHours : [value.openingHours]).some(filled),
    price_range_length: typeof price === 'string' ? price.trim().length : null,
  };
}

/**
 * Every Organization, business or Person at the top level of parsed JSON-LD
 * (the object, each object of a top-level array, and the objects in their
 * `@graph`), in document order, with how many non-empty `sameAs` URLs it gives
 * (a string or an array of them), and its `@id`, `name`, `url` and `logo` (since rule set 0.2.2). An author or publisher nested inside another
 * object describes someone else, so it is not read. At most `MAX_PROFILES`.
 * @param {unknown} data
 * @param {string} text  The block's JSON text.
 * @returns {ProfileEntity[]}
 */
function profileEntities(data, text) {
  /** @type {ProfileEntity[]} */
  const profiles = [];
  for (const value of topNodes(data)) {
    if (profiles.length >= MAX_PROFILES) break;
    const types = (Array.isArray(value['@type']) ? value['@type'] : [value['@type']]).filter((item) => typeof item === 'string');
    const local = types.find((item) => isLocalBusinessType(item));
    const type = local ?? types.find((item) => PROFILE_TYPE.test(item.trim()));
    if (typeof type !== 'string') continue;
    const sameAs = Array.isArray(value.sameAs) ? value.sameAs : [value.sameAs];
    profiles.push({
      type: clip(type.trim(), LIMITS.maxStringLength),
      same_as: sameAs.filter(filled).length,
      id: firstText(value['@id']),
      name: firstText(value.name),
      url: firstText(value.url),
      logo: firstImage(value.logo),
      local: local === undefined ? null : localFields(value, text),
    });
  }
  return profiles;
}

/**
 * The objects at the top level of parsed JSON-LD (the value, or each item of a top-level array) and in their `@graph`,
 * in document order.
 * @param {unknown} data
 * @returns {Record<string, unknown>[]}
 */
function topNodes(data) {
  /** @type {Record<string, unknown>[]} */
  const nodes = [];
  for (const item of Array.isArray(data) ? data : [data]) {
    if (!isObject(item)) continue;
    nodes.push(item);
    const graph = item['@graph'];
    for (const node of Array.isArray(graph) ? graph : [graph]) if (isObject(node)) nodes.push(node);
  }
  return nodes;
}

/**
 * Every Article, NewsArticle or BlogPosting at the top level of a block or in its `@graph`, with what Google's Article
 * page and its authorship advice read (rule set 0.2.4): how many authors it names, how many of them have a name and
 * a `url` or `sameAs`, and whether it gives `datePublished` and `dateModified`. An author given as text counts as named
 * and not linked. At most `MAX_ARTICLES`.
 * @param {unknown} data
 * @returns {ArticleSummary[]}
 */
function articles(data) {
  /** @type {ArticleSummary[]} */
  const out = [];
  for (const value of topNodes(data)) {
    if (out.length >= MAX_ARTICLES) break;
    const types = (Array.isArray(value['@type']) ? value['@type'] : [value['@type']]).filter((item) => typeof item === 'string');
    const type = types.find((item) => ARTICLE_TYPE.test(item.trim()));
    if (typeof type !== 'string') continue;
    const authors = (Array.isArray(value.author) ? value.author : [value.author]).filter((item) => filled(item) || isObject(item));
    const named = authors.filter((item) => filled(item) || (isObject(item) && filled(item.name)));
    const linked = authors.filter((item) => isObject(item) && (filled(item.url) || firstText(item.sameAs) !== null));
    out.push({
      type: clip(type.trim(), LIMITS.maxStringLength),
      authors: authors.length,
      named_authors: named.length,
      linked_authors: linked.length,
      date_published: filled(value.datePublished),
      date_modified: filled(value.dateModified),
    });
  }
  return out;
}

/**
 * Parse the text of one `<script type="application/ld+json">`.
 * `types` holds `@type` values of the top-level object (or of each object in a
 * top-level array) and of the objects in their `@graph`, in order, once each.
 * `videos` holds every `VideoObject` in the block, at any depth, and
 * `profiles` every Organization, business or Person at the top level and in `@graph`, with its `sameAs` count, and
 * `articles` every Article, NewsArticle or BlogPosting there.
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
    return { valid: false, types: [], error: clip(message, LIMITS.maxStringLength), line, videos: [], profiles: [], articles: [] };
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
  return { valid: true, types, error: null, line, videos: videoObjects(data), profiles: profileEntities(data, text), articles: articles(data) };
}
