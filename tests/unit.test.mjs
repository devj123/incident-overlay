/**
 * Unit tests for the pure-logic modules.
 * Run: node --test tests/
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  toEpoch, formatDuration, isActiveAt, clamp, snap, MS,
} from '../js/util/time.js';

import {
  isValidLatLng, distance, lineLength, pointAlong, midpoint, bounds,
  unionBounds, sliceLine, fromGeoJSON, bearing, compassPoint, formatDistance,
} from '../js/util/geo.js';

import { createStore } from '../js/core/store.js';

import {
  normalizeIncident, normalizeFeed, coerceSeverity, coerceType, coerceStatus,
  deriveStatus, filterIncidents, compareIncidents, countBySeverity,
  describeLanes, statusAt, durationAt, isIncidentActiveAt,
} from '../js/data/incident.js';

import { classifyFlow, createMockSource } from '../js/data/sources.js';
import { buildMockIncidents, buildFlowSamples } from '../js/data/mockFeed.js';
import { CORRIDORS } from '../js/data/roads.js';
import { SEVERITY_ORDER, FLOW_ORDER } from '../js/config.js';

/* ============================================================ time utils == */

test('toEpoch parses the formats feeds actually emit', () => {
  assert.equal(toEpoch(null), null);
  assert.equal(toEpoch(''), null);
  assert.equal(toEpoch('not a date'), null);
  assert.equal(toEpoch(undefined), null);

  assert.equal(toEpoch(1_700_000_000_000), 1_700_000_000_000);
  // 10-digit input is treated as seconds
  assert.equal(toEpoch(1_700_000_000), 1_700_000_000_000);

  assert.equal(toEpoch('2026-08-06T14:00:00.000Z'), Date.parse('2026-08-06T14:00:00.000Z'));
  assert.equal(toEpoch(new Date(12345)), 12345);
  assert.equal(toEpoch(new Date('nope')), null);

  // Microsoft/WCF wire format
  assert.equal(toEpoch('/Date(1723000000000-0700)/'), 1723000000000);
  assert.equal(toEpoch('/Date(1723000000000)/'), 1723000000000);
});

test('formatDuration renders sensible spans', () => {
  assert.equal(formatDuration(0), '0s');
  assert.equal(formatDuration(45 * MS.second), '45s');
  assert.equal(formatDuration(90 * MS.second), '2m');
  assert.equal(formatDuration(41 * MS.minute), '41m');
  assert.equal(formatDuration(96 * MS.minute), '1h 36m');
  assert.equal(formatDuration(2 * MS.hour), '2h');
  assert.equal(formatDuration(26 * MS.hour), '1d 2h');
  assert.equal(formatDuration(48 * MS.hour), '2d');
  // negative spans are absolute
  assert.equal(formatDuration(-41 * MS.minute), '41m');
});

test('isActiveAt honours open-ended windows', () => {
  assert.equal(isActiveAt(100, 200, 150), true);
  assert.equal(isActiveAt(100, 200, 100), true);
  assert.equal(isActiveAt(100, 200, 200), false);   // end is exclusive
  assert.equal(isActiveAt(100, 200, 99), false);
  assert.equal(isActiveAt(100, null, 1e9), true);   // ongoing
  assert.equal(isActiveAt(null, 200, 150), false);
});

test('clamp and snap', () => {
  assert.equal(clamp(5, 0, 10), 5);
  assert.equal(clamp(-5, 0, 10), 0);
  assert.equal(clamp(15, 0, 10), 10);
  assert.equal(clamp(NaN, 3, 10), 3);
  assert.equal(snap(1234, 100), 1200);
  assert.equal(snap(1234, 0), 1234);
});

/* ============================================================= geo utils == */

test('isValidLatLng rejects the usual bad input', () => {
  assert.equal(isValidLatLng([47.6, -122.1]), true);
  assert.equal(isValidLatLng([0, 0]), true);
  assert.equal(isValidLatLng([91, 0]), false);
  assert.equal(isValidLatLng([0, 181]), false);
  assert.equal(isValidLatLng([NaN, 0]), false);
  assert.equal(isValidLatLng(['47.6', '-122.1']), false);
  assert.equal(isValidLatLng([47.6]), false);
  assert.equal(isValidLatLng(null), false);
});

test('distance matches a known great-circle span', () => {
  // 1 degree of latitude ≈ 111.19 km
  const d = distance([0, 0], [1, 0]);
  assert.ok(Math.abs(d - 111_195) < 200, `got ${d}`);
  assert.equal(distance([47.6, -122.1], [47.6, -122.1]), 0);
});

test('lineLength sums segments', () => {
  const line = [[0, 0], [0, 1], [0, 2]];
  const total = lineLength(line);
  const twoSteps = distance([0, 0], [0, 1]) + distance([0, 1], [0, 2]);
  assert.ok(Math.abs(total - twoSteps) < 1e-6);
  assert.equal(lineLength([[0, 0]]), 0);
  assert.equal(lineLength([]), 0);
  assert.equal(lineLength(null), 0);
});

test('pointAlong interpolates by arc length', () => {
  const line = [[0, 0], [0, 2]];
  const mid = pointAlong(line, 0.5);
  assert.ok(Math.abs(mid[1] - 1) < 1e-6);

  assert.deepEqual(pointAlong(line, 0), [0, 0]);
  assert.deepEqual(pointAlong(line, 1), [0, 2]);
  // out-of-range fractions clamp
  assert.deepEqual(pointAlong(line, -3), [0, 0]);
  assert.deepEqual(pointAlong(line, 9), [0, 2]);
  assert.equal(pointAlong([], 0.5), null);
  assert.deepEqual(pointAlong([[5, 6]], 0.5), [5, 6]);
  // degenerate (zero-length) line
  assert.deepEqual(pointAlong([[1, 1], [1, 1]], 0.5), [1, 1]);
});

test('midpoint of an even line is its centre', () => {
  assert.ok(Math.abs(midpoint([[0, 0], [0, 4]])[1] - 2) < 1e-6);
});

test('bounds and unionBounds', () => {
  const b = bounds([[1, 2], [3, 4], [-1, 0]]);
  assert.deepEqual(b, { south: -1, west: 0, north: 3, east: 4 });

  assert.equal(bounds([]), null);
  assert.equal(bounds([[999, 999]]), null);   // invalid points filtered out

  const u = unionBounds([
    { south: 0, west: 0, north: 1, east: 1 },
    { south: -2, west: 5, north: 0.5, east: 8 },
  ]);
  assert.deepEqual(u, { south: -2, west: 0, north: 1, east: 8 });
  assert.equal(unionBounds([]), null);
  assert.equal(unionBounds([null, null]), null);
});

test('sliceLine extracts a proportional sub-line', () => {
  const line = [[0, 0], [0, 1], [0, 2], [0, 3], [0, 4]];

  const half = sliceLine(line, 0.25, 0.75);
  assert.ok(Math.abs(half[0][1] - 1) < 1e-6, `start ${half[0][1]}`);
  assert.ok(Math.abs(half[half.length - 1][1] - 3) < 1e-6, `end ${half.at(-1)[1]}`);

  // full slice returns the whole line
  const full = sliceLine(line, 0, 1);
  assert.ok(Math.abs(full[0][1] - 0) < 1e-6);
  assert.ok(Math.abs(full.at(-1)[1] - 4) < 1e-6);

  // reversed inputs are normalised
  const reversed = sliceLine(line, 0.75, 0.25);
  assert.ok(Math.abs(reversed[0][1] - 1) < 1e-6);

  // zero-width slice yields a degenerate two-point line
  const pointSlice = sliceLine(line, 0.5, 0.5);
  assert.equal(pointSlice.length, 2);
  assert.ok(Math.abs(pointSlice[0][1] - 2) < 1e-6);

  // slices are always at least 2 points and stay on the source line
  for (let i = 0; i < 20; i += 1) {
    const a = Math.random();
    const b = Math.random();
    const s = sliceLine(line, a, b);
    assert.ok(s.length >= 2, `slice ${a},${b} → ${s.length} points`);
    for (const [lat, lng] of s) {
      assert.ok(Math.abs(lat) < 1e-9, 'stayed on the meridian');
      assert.ok(lng >= -1e-9 && lng <= 4 + 1e-9, `lng ${lng} in range`);
    }
  }
});

test('fromGeoJSON swaps lng/lat and filters junk', () => {
  assert.deepEqual(fromGeoJSON([-122.1, 47.6]), [[47.6, -122.1]]);
  assert.deepEqual(
    fromGeoJSON([[-122.1, 47.6], [-122.2, 47.7]]),
    [[47.6, -122.1], [47.7, -122.2]],
  );
  assert.deepEqual(fromGeoJSON([[-122.1, 999], [-122.2, 47.7]]), [[47.7, -122.2]]);
  assert.deepEqual(fromGeoJSON(null), []);
});

test('bearing and compass point', () => {
  assert.ok(Math.abs(bearing([0, 0], [1, 0]) - 0) < 1e-6);      // north
  assert.ok(Math.abs(bearing([0, 0], [0, 1]) - 90) < 1e-6);     // east
  assert.equal(compassPoint(0), 'N');
  assert.equal(compassPoint(45), 'NE');
  assert.equal(compassPoint(90), 'E');
  assert.equal(compassPoint(359), 'N');
  assert.equal(compassPoint(-90), 'W');
});

test('formatDistance switches units sensibly', () => {
  assert.match(formatDistance(100), /ft$/);
  assert.match(formatDistance(5000), /mi$/);
  assert.equal(formatDistance(1609.344), '1.0 mi');
});

/* ================================================================ store == */

test('store notifies only on real changes', () => {
  const store = createStore({ a: 1, b: 2 });
  let calls = 0;
  store.subscribe(() => { calls += 1; });

  store.setState({ a: 1 });        // no change
  assert.equal(calls, 0);

  store.setState({ a: 2 });
  assert.equal(calls, 1);

  store.setState({ a: 2, b: 2 });  // still no change
  assert.equal(calls, 1);
});

test('store select fires only when the slice changes', () => {
  const store = createStore({ a: 1, b: 2 });
  const seen = [];
  store.select((s) => s.a, (v) => seen.push(v));

  store.setState({ b: 99 });       // different key
  store.setState({ a: 1 });        // same value
  store.setState({ a: 5 });
  store.setState({ a: 5 });

  assert.deepEqual(seen, [5]);
});

test('store select supports immediate', () => {
  const store = createStore({ a: 7 });
  const seen = [];
  store.select((s) => s.a, (v) => seen.push(v), { immediate: true });
  assert.deepEqual(seen, [7]);
});

test('store accepts an updater function', () => {
  const store = createStore({ n: 1 });
  store.setState((s) => ({ n: s.n + 1 }));
  assert.equal(store.getState().n, 2);
});

test('store unsubscribe stops delivery', () => {
  const store = createStore({ a: 0 });
  let calls = 0;
  const off = store.subscribe(() => { calls += 1; });
  store.setState({ a: 1 });
  off();
  store.setState({ a: 2 });
  assert.equal(calls, 1);
});

test('store survives re-entrant setState', () => {
  const store = createStore({ a: 0, b: 0 });
  store.select((s) => s.a, (v) => {
    if (v < 3) store.setState({ a: v + 1 });
  });
  store.setState({ a: 1 });
  assert.equal(store.getState().a, 3);
});

/* ============================================================== incident == */

test('coerceSeverity accepts our ids, aliases and numeric ranks', () => {
  assert.equal(coerceSeverity('low'), 'low');
  assert.equal(coerceSeverity('MINOR'), 'low');
  assert.equal(coerceSeverity('moderate'), 'medium');
  assert.equal(coerceSeverity('Major'), 'high');
  assert.equal(coerceSeverity('full closure'), 'closure');
  assert.equal(coerceSeverity('road_closed'), 'closure');
  assert.equal(coerceSeverity(1), 'low');
  assert.equal(coerceSeverity(4), 'closure');
  assert.equal(coerceSeverity('nonsense'), null);
  assert.equal(coerceSeverity(null), null);
});

test('coerceType maps common feed vocabularies', () => {
  assert.equal(coerceType('crash'), 'collision');
  assert.equal(coerceType('Road Work'), 'construction');
  assert.equal(coerceType('disabled vehicle'), 'disabled');
  assert.equal(coerceType('debris'), 'hazard');
  assert.equal(coerceType('special event'), 'event');
  assert.equal(coerceType('meteor strike'), null);
});

test('coerceStatus maps common feed vocabularies', () => {
  assert.equal(coerceStatus('OPEN'), 'active');
  assert.equal(coerceStatus('in progress'), 'active');
  assert.equal(coerceStatus('planned'), 'scheduled');
  assert.equal(coerceStatus('resolved'), 'cleared');
  assert.equal(coerceStatus('???'), null);
});

test('deriveStatus reads the time window', () => {
  assert.equal(deriveStatus(100, 200, 50), 'scheduled');
  assert.equal(deriveStatus(100, 200, 150), 'active');
  assert.equal(deriveStatus(100, 200, 250), 'cleared');
  assert.equal(deriveStatus(100, null, 1e9), 'active');
});

test('normalizeIncident produces a complete canonical record', () => {
  const now = Date.parse('2026-08-06T14:00:00Z');
  const { incident, issues } = normalizeIncident({
    id: 'X1',
    type: 'crash',
    severity: 'major',
    headline: 'Collision blocking two lanes',
    description: 'Details here',
    road: { name: 'SR 520', direction: 'Eastbound', mpStart: 6.4, mpEnd: 7.1 },
    geometry: [[47.66, -122.15], [47.665, -122.14]],
    lanes: { total: 3, blocked: 2 },
    startTime: '2026-08-06T13:20:00Z',
    estimatedClearTime: '2026-08-06T14:30:00Z',
    lastUpdated: '2026-08-06T13:55:00Z',
    reportedBy: 'State Patrol',
  }, { now, source: 'test' });

  assert.deepEqual(issues, []);
  assert.equal(incident.id, 'X1');
  assert.equal(incident.type, 'collision');
  assert.equal(incident.severity, 'high');
  assert.equal(incident.status, 'active');
  assert.equal(incident.road.name, 'SR 520');
  assert.equal(incident.lanes.blocked, 2);
  assert.equal(incident.source, 'test');
  assert.equal(incident.geometry.length, 2);
  assert.ok(incident.lengthMeters > 0);
  // no explicit location → geometry midpoint
  assert.ok(incident.location[0] > 47.66 && incident.location[0] < 47.665);
});

test('normalizeIncident rejects records it cannot place', () => {
  const now = Date.now();

  const noId = normalizeIncident({ type: 'collision' }, { now });
  assert.equal(noId.incident, null);
  assert.ok(noId.issues.some((i) => i.includes('id')));

  const noTime = normalizeIncident({ id: 'A', lat: 47.6, lng: -122.1 }, { now });
  assert.equal(noTime.incident, null);
  assert.ok(noTime.issues.some((i) => i.includes('startTime')));

  const noPlace = normalizeIncident({ id: 'A', startTime: now }, { now });
  assert.equal(noPlace.incident, null);
  assert.ok(noPlace.issues.some((i) => i.includes('location')));
});

test('normalizeIncident repairs recoverable problems and reports them', () => {
  const now = Date.now();
  const { incident, issues } = normalizeIncident({
    id: 'B',
    type: 'meteor strike',
    severity: 'catastrophic',
    road: { name: 'SR 520' },
    geometry: [[47.66, -122.14], [999, -122.13], [47.665, -122.12]],
    lanes: { total: 2, blocked: 7 },
    startTime: now - 10_000,
    endTime: now - 40_000,          // before start
  }, { now });

  assert.ok(incident, 'record was salvaged');
  assert.equal(incident.type, 'other');
  assert.equal(incident.severity, 'medium');
  assert.equal(incident.geometry.length, 2, 'invalid vertex dropped');
  assert.equal(incident.lanes.blocked, 2, 'blocked clamped to total');
  assert.equal(incident.endTime, null, 'bad endTime dropped');

  assert.ok(issues.some((i) => i.includes('type')));
  assert.ok(issues.some((i) => i.includes('severity')));
  assert.ok(issues.some((i) => i.includes('geometry')));
  assert.ok(issues.some((i) => i.includes('lanes')));
  assert.ok(issues.some((i) => i.includes('endTime')));
});

test('normalizeIncident accepts several location shapes', () => {
  const now = Date.now();
  const base = { id: 'L', startTime: now };

  const arr = normalizeIncident({ ...base, location: [47.6, -122.1] }, { now });
  assert.deepEqual(arr.incident.location, [47.6, -122.1]);

  const obj = normalizeIncident({ ...base, location: { lat: 47.6, lng: -122.1 } }, { now });
  assert.deepEqual(obj.incident.location, [47.6, -122.1]);

  const lonKey = normalizeIncident({ ...base, location: { lat: 47.6, lon: -122.1 } }, { now });
  assert.deepEqual(lonKey.incident.location, [47.6, -122.1]);

  const flat = normalizeIncident({ ...base, lat: 47.6, lng: -122.1 }, { now });
  assert.deepEqual(flat.incident.location, [47.6, -122.1]);
});

test('normalizeFeed sorts by urgency and counts drops', () => {
  const now = Date.now();
  const { incidents, dropped, issues } = normalizeFeed([
    { id: '1', severity: 'low', startTime: now, lat: 47.6, lng: -122.1 },
    { id: '2', severity: 'closure', startTime: now, lat: 47.6, lng: -122.1 },
    { id: '3', severity: 'medium', startTime: now, lat: 47.6, lng: -122.1 },
    { id: '4', severity: 'high', startTime: now, lat: 47.6, lng: -122.1 },
    { nope: true },
  ], { now });

  assert.deepEqual(incidents.map((i) => i.id), ['2', '4', '3', '1']);
  assert.equal(dropped, 1);
  assert.equal(issues.length, 1);
  assert.equal(normalizeFeed(null).incidents.length, 0);
});

test('compareIncidents orders severity, then status, then recency', () => {
  const mk = (severity, status, lastUpdated) => ({ severity, status, lastUpdated });
  const list = [
    mk('low', 'active', 5),
    mk('high', 'cleared', 5),
    mk('high', 'active', 1),
    mk('high', 'active', 9),
  ].sort(compareIncidents);

  assert.deepEqual(
    list.map((i) => `${i.severity}/${i.status}/${i.lastUpdated}`),
    ['high/active/9', 'high/active/1', 'high/cleared/5', 'low/active/5'],
  );
});

test('filterIncidents applies every predicate', () => {
  const now = 1_000_000;
  const mk = (over) => ({
    id: 'x', severity: 'high', type: 'collision', status: 'active',
    startTime: now - 1000, endTime: null, headline: 'Crash on SR 520',
    description: '', road: { name: 'SR 520', direction: 'EB' }, ...over,
  });

  const all = [
    mk({ id: 'a' }),
    mk({ id: 'b', severity: 'low' }),
    mk({ id: 'c', road: { name: 'I-405', direction: null }, headline: 'Debris' }),
    mk({ id: 'd', startTime: now - 5000, endTime: now - 2000, status: 'cleared' }),
    mk({ id: 'e', startTime: now + 5000, status: 'scheduled' }),
  ];

  assert.deepEqual(
    filterIncidents(all, { severities: ['high'], at: now }).map((i) => i.id),
    ['a', 'c'],
  );

  assert.deepEqual(
    filterIncidents(all, { at: now }).map((i) => i.id),
    ['a', 'b', 'c'],
    'cleared and future incidents excluded at this instant',
  );

  assert.deepEqual(
    filterIncidents(all, { at: now, includeCleared: true }).map((i) => i.id),
    ['a', 'b', 'c', 'd', 'e'],
  );

  assert.deepEqual(
    filterIncidents(all, { at: now, query: '520' }).map((i) => i.id),
    ['a', 'b'],
  );

  assert.deepEqual(
    filterIncidents(all, { at: now + 6000, includeCleared: false }).map((i) => i.id),
    ['a', 'b', 'c', 'e'],
    'scrubbing forward makes the scheduled incident active',
  );
});

test('statusAt / durationAt / isIncidentActiveAt track the scrubber', () => {
  const inc = { startTime: 1000, endTime: 3000 };
  assert.equal(statusAt(inc, 500), 'scheduled');
  assert.equal(statusAt(inc, 2000), 'active');
  assert.equal(statusAt(inc, 4000), 'cleared');

  assert.equal(durationAt(inc, 2000), 1000);
  assert.equal(durationAt(inc, 9000), 2000, 'caps at endTime');
  assert.equal(durationAt(inc, 0), 0, 'never negative');

  assert.equal(isIncidentActiveAt(inc, 2000), true);
  assert.equal(isIncidentActiveAt(inc, 3000), false);
});

test('countBySeverity always returns every key', () => {
  const counts = countBySeverity([{ severity: 'high' }, { severity: 'high' }]);
  assert.deepEqual(Object.keys(counts).sort(), [...SEVERITY_ORDER].sort());
  assert.equal(counts.high, 2);
  assert.equal(counts.low, 0);
});

test('describeLanes prefers the feed note', () => {
  assert.equal(describeLanes({ note: 'Road fully closed', total: 2, blocked: 2 }), 'Road fully closed');
  assert.equal(describeLanes({ note: '', total: 3, blocked: 2 }), '2 of 3 lanes blocked');
  assert.equal(describeLanes({ note: '', total: null, blocked: 1 }), '1 lane blocked');
  assert.equal(describeLanes({ note: '', total: null, blocked: 2 }), '2 lanes blocked');
  assert.equal(describeLanes({ note: '', total: 3, blocked: 0 }), 'All lanes open');
  assert.equal(describeLanes(null), null);
});

/* ================================================================= flow == */

test('classifyFlow buckets speed ratios', () => {
  assert.equal(classifyFlow(60, 60), 'clear');
  assert.equal(classifyFlow(50, 60), 'clear');     // 0.83
  assert.equal(classifyFlow(40, 60), 'moving');    // 0.67
  assert.equal(classifyFlow(20, 60), 'slow');      // 0.33
  assert.equal(classifyFlow(5, 60), 'stopgo');     // 0.08
  assert.equal(classifyFlow(0, 60), 'stopgo');
  assert.equal(classifyFlow(NaN, 60), 'unknown');
  assert.equal(classifyFlow(30, 0), 'unknown');
  assert.ok(FLOW_ORDER.includes(classifyFlow(30, 60)));
});

/* ============================================================== mock feed == */

test('mock incidents all normalize cleanly', () => {
  const now = Date.now();
  const raw = buildMockIncidents({ now });
  const { incidents, issues, dropped } = normalizeFeed(raw, { now, source: 'mock' });

  assert.equal(dropped, 0, 'no demo record should be dropped');
  assert.deepEqual(issues, [], `unexpected issues: ${JSON.stringify(issues)}`);
  assert.equal(incidents.length, raw.length);

  // The dataset should cover every severity and all three statuses.
  const severities = new Set(incidents.map((i) => i.severity));
  for (const s of SEVERITY_ORDER) assert.ok(severities.has(s), `missing severity ${s}`);

  const statuses = new Set(incidents.map((i) => i.status));
  for (const s of ['active', 'scheduled', 'cleared']) {
    assert.ok(statuses.has(s), `missing status ${s}`);
  }

  // Every incident must be placeable on the map.
  for (const inc of incidents) {
    assert.ok(isValidLatLng(inc.location), `${inc.id} has a bad location`);
    for (const pt of inc.geometry) {
      assert.ok(isValidLatLng(pt), `${inc.id} has a bad geometry vertex`);
    }
  }

  // The headline collision must be the demo's top-ranked incident group.
  const headline = incidents.find((i) => i.id === 'INC-2201');
  assert.ok(headline);
  assert.equal(headline.severity, 'high');
  assert.equal(headline.status, 'active');
  assert.equal(headline.lanes.blocked, 2);
  assert.ok(headline.geometry.length >= 2, 'headline incident needs a segment');
});

test('malformed demo records are caught, not crashed on', () => {
  const now = Date.now();
  const raw = buildMockIncidents({ now, includeMalformed: true });
  const { incidents, issues, dropped } = normalizeFeed(raw, { now });

  assert.equal(dropped, 2, 'two records are unsalvageable');
  assert.ok(issues.length >= 3);
  assert.ok(incidents.some((i) => i.id === 'INC-BAD-2'), 'the repairable one survives');
});

test('mock geometry sits on the corridors it claims', () => {
  const now = Date.now();
  const { incidents } = normalizeFeed(buildMockIncidents({ now }), { now });

  for (const inc of incidents) {
    if (inc.geometry.length < 2) continue;
    const corridor = CORRIDORS.find(
      (c) => c.name === inc.road.name || c.shortName === inc.road.name,
    );
    if (!corridor) continue;

    // Every vertex should be within ~1 km of some corridor vertex.
    for (const pt of inc.geometry) {
      const nearest = Math.min(...corridor.path.map((p) => distance(p, pt)));
      assert.ok(nearest < 1000, `${inc.id} vertex is ${Math.round(nearest)}m off ${corridor.id}`);
    }
  }
});

test('flow samples cover every corridor segment and classify', () => {
  const now = Date.now();
  const { incidents } = normalizeFeed(buildMockIncidents({ now }), { now });
  const samples = buildFlowSamples({ now, incidents });

  const expected = CORRIDORS.reduce((sum, c) => sum + c.path.length - 1, 0);
  assert.equal(samples.length, expected);

  for (const s of samples) {
    assert.equal(s.path.length, 2);
    assert.ok(isValidLatLng(s.path[0]) && isValidLatLng(s.path[1]));
    assert.ok(s.currentMph >= 0 && s.currentMph <= s.freeFlowMph * 1.1);
  }

  // Deterministic: two builds with the same inputs agree.
  const again = buildFlowSamples({ now, incidents });
  assert.deepEqual(samples.map((s) => s.currentMph), again.map((s) => s.currentMph));
});

test('congestion appears upstream of the SR 520 collision', () => {
  const now = Date.now();
  const { incidents } = normalizeFeed(buildMockIncidents({ now }), { now });
  const samples = buildFlowSamples({ now, incidents })
    .filter((s) => s.corridorId === 'sr520')
    .map((s) => ({ ...s, flow: classifyFlow(s.currentMph, s.freeFlowMph) }));

  const congested = samples.filter((s) => s.flow === 'slow' || s.flow === 'stopgo');
  assert.ok(congested.length > 0, 'the collision should slow SR 520 down');

  const free = samples.filter((s) => s.flow === 'clear');
  assert.ok(free.length > 0, 'the whole corridor should not be red');
});

/* ================================================================ source == */

test('mock source returns a normalized, classified payload', async () => {
  const source = createMockSource({ latencyMs: 0 });
  const result = await source.fetch({ now: Date.now() });

  assert.ok(Array.isArray(result.incidents) && result.incidents.length > 0);
  assert.ok(Array.isArray(result.flow) && result.flow.length > 0);
  assert.ok(result.flow.every((s) => FLOW_ORDER.includes(s.flow)));
  assert.equal(typeof result.fetchedAt, 'number');
});

test('mock source honours an abort signal', async () => {
  const source = createMockSource({ latencyMs: 50 });
  const controller = new AbortController();
  const pending = source.fetch({ signal: controller.signal, now: Date.now() });
  controller.abort();
  await assert.rejects(pending, (err) => err.name === 'AbortError');
});

test('mock source surfaces simulated failures', async () => {
  const source = createMockSource({ latencyMs: 0, failureRate: 1 });
  await assert.rejects(source.fetch({ now: Date.now() }), /Simulated feed failure/);
});
