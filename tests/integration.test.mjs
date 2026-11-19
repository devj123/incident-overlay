/**
 * Integration tests that need a bit more than pure functions:
 *  - the HTTP adapter against a real (local) server
 *  - the poller's retry/backoff behaviour
 *  - store fault isolation
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';

import { createHttpSource, createPoller } from '../js/data/sources.js';
import { createStore } from '../js/core/store.js';
import { buildMockIncidents } from '../js/data/mockFeed.js';
import { FLOW_ORDER } from '../js/config.js';

/** Spin up a throwaway HTTP server; returns { url, close, hits }. */
async function serveJson(handler) {
  const state = { hits: 0 };
  const server = createServer((req, res) => {
    state.hits += 1;
    const result = handler(state.hits, req);
    res.writeHead(result.status ?? 200, { 'Content-Type': 'application/json' });
    res.end(typeof result.body === 'string' ? result.body : JSON.stringify(result.body));
  });

  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();

  return {
    url: `http://127.0.0.1:${port}/feed.json`,
    hits: () => state.hits,
    close: () => new Promise((r) => server.close(r)),
  };
}

/* ============================================================ http source == */

test('http source fetches, normalizes and classifies', async () => {
  const now = Date.now();
  const server = await serveJson(() => ({
    body: {
      incidents: buildMockIncidents({ now }),
      flow: [
        { corridorId: 'sr520', index: 0, path: [[47.64, -122.19], [47.64, -122.18]], freeFlowMph: 60, currentMph: 12 },
        { corridorId: 'sr520', index: 1, path: [[47.64, -122.18], [47.65, -122.17]], freeFlowMph: 60, currentMph: 58 },
      ],
    },
  }));

  try {
    const source = createHttpSource({ url: server.url });
    const result = await source.fetch({ now });

    assert.ok(result.incidents.length > 0);
    assert.equal(result.dropped, 0);
    assert.deepEqual(result.issues, []);

    assert.equal(result.flow.length, 2);
    assert.equal(result.flow[0].flow, 'stopgo');   // 12/60 = 0.2
    assert.equal(result.flow[1].flow, 'clear');    // 58/60 = 0.97
    assert.ok(result.flow.every((s) => FLOW_ORDER.includes(s.flow)));

    // Records carry the feed URL as their provenance.
    assert.ok(result.incidents.every((i) => i.source === server.url));
  } finally {
    await server.close();
  }
});

test('http source accepts a bare array payload', async () => {
  const now = Date.now();
  const server = await serveJson(() => ({ body: buildMockIncidents({ now }) }));
  try {
    const source = createHttpSource({ url: server.url });
    const result = await source.fetch({ now });
    assert.ok(result.incidents.length > 0);
  } finally {
    await server.close();
  }
});

test('http source supports a custom extractor', async () => {
  const now = Date.now();
  const server = await serveJson(() => ({
    body: { data: { events: buildMockIncidents({ now }) } },
  }));
  try {
    const source = createHttpSource({
      url: server.url,
      extract: (payload) => ({ incidents: payload.data.events, flow: [] }),
    });
    const result = await source.fetch({ now });
    assert.ok(result.incidents.length > 0);
  } finally {
    await server.close();
  }
});

test('http source raises on a non-2xx response', async () => {
  const server = await serveJson(() => ({ status: 503, body: { error: 'down' } }));
  try {
    const source = createHttpSource({ url: server.url });
    await assert.rejects(source.fetch({ now: Date.now() }), /503/);
  } finally {
    await server.close();
  }
});

test('http source raises on malformed JSON', async () => {
  const server = await serveJson(() => ({ body: '{ not json' }));
  try {
    const source = createHttpSource({ url: server.url });
    await assert.rejects(source.fetch({ now: Date.now() }));
  } finally {
    await server.close();
  }
});

/* ================================================================ poller == */

test('poller delivers data then keeps polling', async () => {
  const received = [];
  const states = [];

  const source = {
    label: 'stub',
    async fetch() {
      return { incidents: [], flow: [], issues: [], dropped: 0, fetchedAt: Date.now() };
    },
  };

  const poller = createPoller({
    source,
    intervalMs: 20,
    onData: (r) => received.push(r),
    onStateChange: (s) => states.push(s),
  });

  poller.start();
  await new Promise((r) => setTimeout(r, 120));
  poller.stop();

  assert.ok(received.length >= 2, `polled ${received.length} times`);
  assert.ok(states.includes('loading'));
  assert.ok(states.includes('ok'));
  assert.equal(states.at(-1), 'idle', 'stop() reports idle');
});

test('poller backs off on failure and recovers', async () => {
  let calls = 0;
  const states = [];
  const received = [];

  const source = {
    label: 'flaky',
    async fetch() {
      calls += 1;
      if (calls <= 2) throw new Error('boom');
      return { incidents: [], flow: [], issues: [], dropped: 0, fetchedAt: Date.now() };
    },
  };

  const poller = createPoller({
    source,
    intervalMs: 10,
    onData: (r) => received.push(r),
    onStateChange: (s) => states.push(s),
  });

  poller.start();
  // First failure retries after 1 s, second after 3 s — force it along instead.
  await new Promise((r) => setTimeout(r, 30));
  poller.refresh();
  await new Promise((r) => setTimeout(r, 30));
  poller.refresh();
  await new Promise((r) => setTimeout(r, 60));
  poller.stop();

  assert.ok(states.includes('error'), 'error state was reported');
  assert.ok(received.length >= 1, 'recovered and delivered data');
});

test('poller stop() prevents further delivery', async () => {
  let calls = 0;
  const source = {
    async fetch() {
      calls += 1;
      return { incidents: [], flow: [], issues: [], dropped: 0, fetchedAt: Date.now() };
    },
  };

  const poller = createPoller({ source, intervalMs: 10, onData() {} });
  poller.start();
  await new Promise((r) => setTimeout(r, 35));
  const atStop = calls;
  poller.stop();
  await new Promise((r) => setTimeout(r, 50));

  assert.equal(calls, atStop, 'no polls after stop()');
});

/* ================================================= store fault isolation == */

test('a throwing subscriber does not break its siblings or the caller', () => {
  const store = createStore({ n: 0 });
  const caught = [];
  store.setErrorHandler((e) => caught.push(e));

  const seen = [];
  store.select((s) => s.n, () => { throw new Error('render blew up'); });
  store.select((s) => s.n, (v) => seen.push(v));

  // Must not throw out of setState — otherwise a rendering fault gets
  // misattributed to whatever triggered the update (e.g. the feed poller).
  assert.doesNotThrow(() => store.setState({ n: 1 }));

  assert.equal(caught.length, 1);
  assert.match(caught[0].message, /render blew up/);
  assert.deepEqual(seen, [1], 'the healthy subscriber still ran');
});

test('setErrorHandler returns the previous handler', () => {
  const store = createStore({ n: 0 });
  const first = () => {};
  const previous = store.setErrorHandler(first);
  assert.equal(typeof previous, 'function');
  assert.equal(store.setErrorHandler(() => {}), first);
});
