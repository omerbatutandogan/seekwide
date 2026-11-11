// A stand-in for Google's two APIs on 127.0.0.1, with answers shaped like the
// real ones (the official examples and the discovery documents, read
// 2026-11-11), so no test ever sends a request to Google.

import { startServer } from './http-server.js';

export const PSI_PATH = '/pagespeedonline/v5/runPagespeed';
export const CRUX_PATH = '/v1/records:queryRecord';

/**
 * @typedef {Object} Reply
 * @property {number} [status]   Defaults to 200.
 * @property {unknown} [json]    Sent as the JSON body.
 * @property {string|Buffer} [body]  Sent as is, in place of `json`.
 * @property {Record<string, string>} [headers]
 * @property {boolean} [hang]    Never answer.
 */

/**
 * @typedef {Object} SeenRequest
 * @property {'psi'|'crux'} api
 * @property {string} method
 * @property {string} path
 * @property {Record<string, string>} query
 * @property {import('node:http').IncomingHttpHeaders} headers
 * @property {any} body   Parsed JSON body, or null.
 */

/**
 * A PageSpeed Insights answer for a page. Times in milliseconds.
 * @param {{url?: string, lcp?: number|null, cls?: number|null, tbt?: number|null, formFactor?: string,
 *          version?: string, finalUrl?: string, runtimeError?: {code: string, message: string}}} [values]
 */
export function psiAnswer(values = {}) {
  const { url = 'https://example.test/', lcp = 1800.4, cls = 0.0204, tbt = 120.6, formFactor = 'mobile', version = '12.8.2' } = values;
  /** @param {string} id @param {number|null} numericValue @param {string} numericUnit @param {string} displayValue */
  const audit = (id, numericValue, numericUnit, displayValue) =>
    numericValue === null
      ? { id, title: id, description: 'An audit.', score: null, scoreDisplayMode: 'error', errorMessage: 'NO_LCP' }
      : { id, title: id, description: 'An audit.', score: 0.9, scoreDisplayMode: 'numeric', displayValue, numericValue, numericUnit };
  return {
    captchaResult: 'CAPTCHA_NOT_NEEDED',
    kind: 'pagespeedonline#result',
    id: values.finalUrl ?? url,
    // Field data that Google plans to remove from this answer; the client must not use it.
    loadingExperience: {
      id: url,
      metrics: { LARGEST_CONTENTFUL_PAINT_MS: { percentile: 9999, distributions: [], category: 'SLOW' } },
      overall_category: 'SLOW',
      initial_url: url,
    },
    lighthouseResult: {
      requestedUrl: url,
      finalUrl: values.finalUrl ?? url,
      mainDocumentUrl: values.finalUrl ?? url,
      finalDisplayedUrl: values.finalUrl ?? url,
      lighthouseVersion: version,
      userAgent: 'Mozilla/5.0 (X11; Linux x86_64) HeadlessChrome/140.0.0.0',
      fetchTime: '2026-11-11T08:00:00.000Z',
      environment: { networkUserAgent: 'Mozilla/5.0 (Linux; Android 11; moto g power (2022))', hostUserAgent: 'HeadlessChrome', benchmarkIndex: 1500 },
      runWarnings: [],
      ...(values.runtimeError ? { runtimeError: values.runtimeError } : {}),
      configSettings: { emulatedFormFactor: formFactor, formFactor, locale: 'en-US', onlyCategories: ['performance'], channel: 'lr' },
      audits: {
        'largest-contentful-paint': audit('largest-contentful-paint', lcp, 'millisecond', '1.8 s'),
        'cumulative-layout-shift': audit('cumulative-layout-shift', cls, 'unitless', '0.02'),
        'total-blocking-time': audit('total-blocking-time', tbt, 'millisecond', '120 ms'),
        'first-contentful-paint': audit('first-contentful-paint', 900, 'millisecond', '0.9 s'),
      },
      categories: { performance: { id: 'performance', title: 'Performance', score: 0.95, auditRefs: [] } },
      timing: { total: 9000 },
    },
    analysisUTCTimestamp: '2026-11-11T08:00:00.000Z',
  };
}

/**
 * A Chrome UX Report answer. Layout shift is a string, as the API sends it.
 * @param {{url?: string, origin?: string, formFactor?: string, lcp?: number|null, inp?: number|null, cls?: string|null,
 *          lcpEnd?: number}} [values]  `lcpEnd`: upper bound of the first LCP bin (2500 in the real API).
 */
export function cruxAnswer(values = {}) {
  const { formFactor = 'PHONE', lcp = 2100, inp = 150, cls = '0.05', lcpEnd = 2500 } = values;
  const key = values.origin ? { formFactor, origin: values.origin } : { formFactor, url: values.url ?? 'https://example.test/' };
  /** @type {Record<string, unknown>} */
  const metrics = {};
  if (lcp !== null) {
    metrics.largest_contentful_paint = {
      histogram: [{ start: 0, end: lcpEnd, density: 0.8234 }, { start: lcpEnd, end: 4000, density: 0.1 }, { start: 4000, density: 0.0766 }],
      percentiles: { p75: lcp },
    };
  }
  if (inp !== null) {
    metrics.interaction_to_next_paint = {
      histogram: [{ start: 0, end: 200, density: 0.9 }, { start: 200, end: 500, density: 0.07 }, { start: 500, density: 0.03 }],
      percentiles: { p75: inp },
    };
  }
  if (cls !== null) {
    metrics.cumulative_layout_shift = {
      histogram: [{ start: '0.00', end: '0.10', density: 0.93 }, { start: '0.10', end: '0.25', density: 0.04 }, { start: '0.25', density: 0.03 }],
      percentiles: { p75: cls },
    };
  }
  return {
    record: {
      key,
      metrics,
      collectionPeriod: { firstDate: { year: 2026, month: 10, day: 12 }, lastDate: { year: 2026, month: 11, day: 8 } },
    },
  };
}

/**
 * An error in the format Google's APIs use.
 * @param {number} code      HTTP status.
 * @param {string} status    For example "RESOURCE_EXHAUSTED".
 * @param {string} [reason]  `ErrorInfo.reason`, for example "API_KEY_INVALID".
 * @param {string} [message]
 * @returns {Reply}
 */
export function googleError(code, status, reason, message = 'A message that names project_number:1234567890.') {
  return {
    status: code,
    json: {
      error: {
        code,
        message,
        status,
        details: reason ? [{ '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason, domain: 'googleapis.com', metadata: { consumer: 'projects/1234567890' } }] : [],
      },
    },
  };
}

/** What the real APIs answered without a key on 2026-11-11. */
export const KEYLESS_PSI = googleError(429, 'RESOURCE_EXHAUSTED', 'RATE_LIMIT_EXCEEDED', "Quota exceeded for quota metric 'Queries' and limit 'Queries per day'.");
export const INVALID_KEY = googleError(400, 'INVALID_ARGUMENT', 'API_KEY_INVALID', 'API key not valid. Please pass a valid API key.');
export const NO_CRUX_DATA = googleError(404, 'NOT_FOUND', undefined, 'chrome ux report data not found');

/**
 * Start the fake. `psi` and `crux` decide each answer; by default both answer
 * with good values for whatever they are asked about.
 * @param {{psi?: (request: SeenRequest) => Reply, crux?: (request: SeenRequest) => Reply}} [handlers]
 */
export async function startGoogle(handlers = {}) {
  const psi = handlers.psi ?? ((request) => ({ json: psiAnswer({ url: request.query.url }) }));
  const crux = handlers.crux ?? ((request) => ({ json: cruxAnswer(request.body ?? {}) }));
  /** @type {SeenRequest[]} */
  const requests = [];

  /** @param {'psi'|'crux'} api @param {(request: SeenRequest) => Reply} decide */
  const route = (api, decide) => (/** @type {import('node:http').IncomingMessage} */ req, /** @type {import('node:http').ServerResponse} */ res) => {
    /** @type {Buffer[]} */
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const target = new URL(req.url ?? '/', 'http://127.0.0.1');
      const text = Buffer.concat(chunks).toString('utf8');
      let body = null;
      try {
        body = text === '' ? null : JSON.parse(text);
      } catch {
        body = text;
      }
      /** @type {SeenRequest} */
      const seen = { api, method: req.method ?? '', path: target.pathname, query: Object.fromEntries(target.searchParams), headers: req.headers, body };
      requests.push(seen);
      const reply = decide(seen);
      if (reply.hang) return;
      const payload = reply.body ?? JSON.stringify(reply.json ?? {});
      res.writeHead(reply.status ?? 200, { 'content-type': 'application/json; charset=UTF-8', ...reply.headers });
      res.end(payload);
    });
  };

  const server = await startServer({ [PSI_PATH]: route('psi', psi), [CRUX_PATH]: route('crux', crux) });
  return {
    origin: server.origin,
    psiEndpoint: `${server.origin}${PSI_PATH}`,
    cruxEndpoint: `${server.origin}${CRUX_PATH}`,
    requests,
    /** Every request the server saw, including ones to other paths. */
    raw: server.requests,
    close: server.close,
  };
}
