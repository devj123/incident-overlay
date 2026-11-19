/**
 * sources.js — feed adapters.
 *
 * An IncidentSource is anything with:
 *
 *   { id, label, fetch({ signal, now }) -> Promise<{ incidents, flow, issues, fetchedAt }> }
 *
 * The app talks only to this interface, so swapping the mock for a real feed
 * is a one-line change in main.js. Two implementations ship here:
 *
 *   MockSource   — in-process synthetic data, no network
 *   HttpSource   — GETs JSON and runs it through the same normalizer
 *
 * `HttpSource` is written against a generic `{ incidents: [...] }` payload with
 * a pluggable `extract` so it can be pointed at a real agency feed without
 * touching anything downstream.
 */

import { normalizeFeed } from './incident.js';
import { buildMockIncidents, buildFlowSamples } from './mockFeed.js';
import { FEED, FLOW_THRESHOLDS } from '../config.js';

/**
 * Bucket a speed sample into a flow class id.
 * @param {number} currentMph
 * @param {number} freeFlowMph
 */
export function classifyFlow(currentMph, freeFlowMph) {
  if (!Number.isFinite(currentMph) || !Number.isFinite(freeFlowMph) || freeFlowMph <= 0) {
    return 'unknown';
  }
  const ratio = currentMph / freeFlowMph;
  for (const threshold of FLOW_THRESHOLDS) {
    if (ratio >= threshold.min) return threshold.id;
  }
  return 'stopgo';
}

/** Attach a flow class to each raw speed sample. */
function classifySamples(samples) {
  return samples.map((s) => ({
    ...s,
    flow: classifyFlow(s.currentMph, s.freeFlowMph),
    ratio: s.freeFlowMph > 0 ? s.currentMph / s.freeFlowMph : null,
  }));
}

/* ------------------------------------------------------------------ mock -- */

/**
 * In-process synthetic source. Optionally simulates latency and failures so
 * the loading and error states are reachable in the prototype.
 *
 * @param {{ latencyMs?:number, failureRate?:number, includeMalformed?:boolean }} [opts]
 */
export function createMockSource(opts = {}) {
  const latencyMs = opts.latencyMs ?? 260;
  const failureRate = opts.failureRate ?? 0;

  return {
    id: 'mock',
    label: 'Mock feed',

    async fetch({ signal, now = Date.now() } = {}) {
      await delay(latencyMs, signal);

      if (failureRate > 0 && Math.random() < failureRate) {
        throw new Error('Simulated feed failure');
      }

      const raw = buildMockIncidents({ now, includeMalformed: opts.includeMalformed });
      const { incidents, issues, dropped } = normalizeFeed(raw, { now, source: 'mock' });
      const flow = classifySamples(buildFlowSamples({ now, incidents }));

      return { incidents, flow, issues, dropped, fetchedAt: now };
    },
  };
}

/* ------------------------------------------------------------------ http -- */

/**
 * Generic HTTP JSON source.
 *
 * @param {{
 *   url: string,
 *   label?: string,
 *   headers?: Record<string,string>,
 *   extract?: (payload:any) => { incidents:any[], flow?:any[] },
 * }} config
 */
export function createHttpSource(config) {
  const {
    url,
    label = 'HTTP feed',
    headers = {},
    extract = (payload) => ({
      incidents: Array.isArray(payload) ? payload : (payload?.incidents ?? []),
      flow: payload?.flow ?? [],
    }),
  } = config;

  return {
    id: 'http',
    label,

    async fetch({ signal, now = Date.now() } = {}) {
      const controller = new AbortController();
      const onAbort = () => controller.abort();
      signal?.addEventListener('abort', onAbort, { once: true });
      const timer = setTimeout(() => controller.abort(), FEED.timeoutMs);

      try {
        const response = await globalThis.fetch(url, {
          headers: { Accept: 'application/json', ...headers },
          signal: controller.signal,
        });
        if (!response.ok) {
          throw new Error(`Feed responded ${response.status} ${response.statusText}`);
        }
        const payload = await response.json();
        const { incidents: rawIncidents, flow: rawFlow = [] } = extract(payload);
        const { incidents, issues, dropped } = normalizeFeed(rawIncidents, { now, source: url });

        return {
          incidents,
          flow: classifySamples(rawFlow),
          issues,
          dropped,
          fetchedAt: now,
        };
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
      }
    },
  };
}

/* ------------------------------------------------------------- poller ----- */

/**
 * Polls a source on an interval with retry/backoff, and reports state
 * transitions through callbacks. Handles the page being hidden (pauses) and
 * the tab regaining focus (immediate refresh).
 *
 * @param {{
 *   source: { fetch: Function, label?: string },
 *   intervalMs?: number,
 *   onData: (result:any)=>void,
 *   onStateChange?: (state:'idle'|'loading'|'ok'|'error', detail?:any)=>void,
 * }} opts
 */
export function createPoller({ source, intervalMs = FEED.pollIntervalMs, onData, onStateChange }) {
  let timer = null;
  let controller = null;
  let attempt = 0;
  let stopped = true;
  let inFlight = false;

  const setState = (state, detail) => onStateChange?.(state, detail);

  async function run() {
    if (stopped || inFlight) return;
    inFlight = true;
    controller = new AbortController();
    setState('loading');

    try {
      const result = await source.fetch({ signal: controller.signal, now: Date.now() });
      if (stopped) return;
      attempt = 0;
      onData(result);
      setState('ok', result);
      schedule(intervalMs);
    } catch (error) {
      if (stopped || error?.name === 'AbortError') return;
      setState('error', error);
      const backoff = FEED.retryBackoffMs[Math.min(attempt, FEED.retryBackoffMs.length - 1)];
      attempt += 1;
      schedule(backoff);
    } finally {
      inFlight = false;
      controller = null;
    }
  }

  function schedule(ms) {
    clearTimeout(timer);
    if (stopped) return;
    timer = setTimeout(run, ms);
  }

  // The poller is otherwise environment-agnostic; don't make it require a DOM
  // just to pause on tab-hide. Under Node (tests, workers) this is simply off.
  const doc = typeof document === 'undefined' ? null : document;

  function onVisibility() {
    if (doc?.visibilityState === 'visible' && !stopped) {
      run();
    } else {
      clearTimeout(timer);
    }
  }

  return {
    start() {
      if (!stopped) return;
      stopped = false;
      doc?.addEventListener('visibilitychange', onVisibility);
      run();
    },
    /** Force an immediate refresh, resetting any backoff. */
    refresh() {
      attempt = 0;
      clearTimeout(timer);
      run();
    },
    stop() {
      stopped = true;
      clearTimeout(timer);
      controller?.abort();
      doc?.removeEventListener('visibilitychange', onVisibility);
      setState('idle');
    },
  };
}

/* ------------------------------------------------------------------ util -- */

function delay(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    }, { once: true });
  });
}
