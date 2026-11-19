/**
 * smoke.mjs — boots the whole app in jsdom with the real Leaflet build and
 * asserts that the DOM it produces is the DOM we intended.
 *
 * This is not a substitute for looking at it in a browser, but it catches the
 * class of bug that unit tests miss: bad selectors, mount points that don't
 * exist, components that throw on first render, layers that never attach.
 *
 * Run: node tools/smoke.mjs
 * (needs jsdom available on the module path)
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { JSDOM, VirtualConsole } from 'jsdom';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

let failures = 0;
let checks = 0;

function check(label, condition, detail) {
  checks += 1;
  if (condition) {
    console.log(`  [32m✓[0m ${label}`);
  } else {
    failures += 1;
    console.log(`  [31m✗[0m ${label}${detail ? `\n      ${detail}` : ''}`);
  }
}

function section(name) {
  console.log(`\n[1m${name}[0m`);
}

/* ------------------------------------------------------------- bootstrap -- */

const html = readFileSync(resolve(root, 'index.html'), 'utf8');

const virtualConsole = new VirtualConsole();
const consoleErrors = [];
virtualConsole.on('jsdomError', (e) => consoleErrors.push(e));
virtualConsole.on('error', (...args) => consoleErrors.push(args.join(' ')));

const dom = new JSDOM(html, {
  url: 'http://localhost:5173/',
  pretendToBeVisual: true,
  runScripts: 'dangerously',
  virtualConsole,
});

const { window } = dom;

// jsdom has no layout engine: give the map container a real size so Leaflet
// computes sane pixel bounds instead of a 0×0 viewport.
Object.defineProperty(window.HTMLElement.prototype, 'clientWidth', { value: 1280, configurable: true });
Object.defineProperty(window.HTMLElement.prototype, 'clientHeight', { value: 800, configurable: true });
Object.defineProperty(window.HTMLElement.prototype, 'offsetWidth', { value: 1280, configurable: true });
Object.defineProperty(window.HTMLElement.prototype, 'offsetHeight', { value: 800, configurable: true });
window.HTMLElement.prototype.getBoundingClientRect = function getBoundingClientRect() {
  return { top: 0, left: 0, right: 1280, bottom: 800, width: 1280, height: 800, x: 0, y: 0, toJSON() {} };
};

// Leaflet reads these during init.
window.matchMedia = window.matchMedia || (() => ({ matches: false, addEventListener() {}, removeEventListener() {} }));

// Expose the jsdom globals the ES modules expect.
for (const key of [
  'window', 'document', 'navigator', 'location', 'history', 'DOMParser',
  'Node', 'Element', 'HTMLElement', 'Event', 'CustomEvent', 'MouseEvent',
  'KeyboardEvent', 'SVGElement', 'getComputedStyle', 'requestAnimationFrame',
  'cancelAnimationFrame', 'AbortController', 'DOMException', 'URLSearchParams',
]) {
  if (!(key in window)) continue;
  // Some Node globals (navigator, location) are getter-only; redefine rather
  // than assign so the jsdom versions win.
  try {
    Object.defineProperty(globalThis, key, {
      value: window[key], writable: true, configurable: true, enumerable: false,
    });
  } catch {
    /* leave the Node built-in in place */
  }
}
globalThis.self = window;

// Execute the vendored Leaflet build inside the jsdom window, then hoist `L`.
const leafletSource = readFileSync(resolve(root, 'vendor/leaflet/leaflet.js'), 'utf8');
const script = window.document.createElement('script');
script.textContent = leafletSource;
window.document.head.appendChild(script);

globalThis.L = window.L;

section('Environment');
check('Leaflet evaluated in the jsdom window', typeof window.L === 'object' && typeof window.L.map === 'function');
check('map mount point exists', !!window.document.getElementById('map'));

/* ------------------------------------------------------------------ boot -- */

let bootError = null;
try {
  await import('../js/main.js');
} catch (error) {
  bootError = error;
}

section('Boot');
check('main.js imported without throwing', !bootError, bootError?.stack);
if (bootError) {
  console.log(`\n[31m${checks - failures}/${checks} checks passed[0m`);
  process.exit(1);
}

const overlay = window.__overlay ?? globalThis.__overlay;
check('debug handle published on window', !!overlay);

// Let the mock feed (300 ms latency) land and the store settle.
await new Promise((r) => setTimeout(r, 900));

const { store, map, incidentLayer, flowLayer } = overlay;
const state = store.getState();

/* ------------------------------------------------------------------ data -- */

section('Data');
check('feed delivered incidents', state.incidents.length > 0, `got ${state.incidents.length}`);
check('feed delivered flow samples', state.flow.length > 0, `got ${state.flow.length}`);
check('feed reported no validation issues', state.issues.length === 0, JSON.stringify(state.issues));
check('feed state is ok', state.feedState === 'ok', state.feedState);
check('fetchedAt was recorded', typeof state.fetchedAt === 'number');
check(
  'visibleIncidents derived from filters',
  state.visibleIncidents.length > 0 && state.visibleIncidents.length <= state.incidents.length,
  `${state.visibleIncidents.length} of ${state.incidents.length}`,
);
check(
  'cleared incidents hidden by default',
  !state.visibleIncidents.some((i) => i.status === 'cleared'),
);

/* ---------------------------------------------------------------- layers -- */

section('Layers');
const panes = map.getPanes();
check('flow pane created below the overlay pane', panes['io-flow']?.style.zIndex === '390');
check('segment pane created', panes['io-segments']?.style.zIndex === '420');
check('marker pane created above markers', panes['io-markers']?.style.zIndex === '620');
check('flow pane ignores pointer events', panes['io-flow']?.style.pointerEvents === 'none');

check(
  'incident layer built one entry per visible incident',
  incidentLayer.size === state.visibleIncidents.length,
  `layer ${incidentLayer.size} vs state ${state.visibleIncidents.length}`,
);

const markerNodes = window.document.querySelectorAll('.inc-marker');
check(
  'a marker element exists for every visible incident',
  markerNodes.length === state.visibleIncidents.length,
  `${markerNodes.length} markers`,
);

const badges = window.document.querySelectorAll('.inc-marker__badge');
check('marker badges rendered', badges.length === markerNodes.length);
check(
  'markers carry an accessible label',
  Array.from(markerNodes).every((n) => n.getAttribute('aria-label')),
);
check(
  'markers are exposed as buttons',
  Array.from(markerNodes).every((n) => n.getAttribute('role') === 'button'),
);

const closureIncident = state.visibleIncidents.find((i) => i.severity === 'closure');
check('demo includes a closure-severity incident', !!closureIncident);
if (closureIncident) {
  const closureMarker = Array.from(markerNodes).find(
    (n) => n.className.includes('inc-marker--closure'),
  );
  check('closure marker uses the closure modifier class', !!closureMarker);
  const badge = closureMarker?.querySelector('.inc-marker__badge');
  check(
    'closure marker is painted near-black',
    badge?.getAttribute('style')?.includes('#1f2429'),
    badge?.getAttribute('style'),
  );
}

const highIncident = state.visibleIncidents.find((i) => i.severity === 'high');
check('demo includes a high-severity incident', !!highIncident);
check(
  'active high-severity markers pulse',
  window.document.querySelectorAll('.inc-marker__pulse').length > 0,
);

const segmentPaths = panes['io-segments']?.querySelectorAll('path') ?? [];
check('incident segments rendered as SVG paths', segmentPaths.length > 0, `${segmentPaths.length} paths`);
check(
  'segments use the casing + core + dash treatment',
  panes['io-segments'].querySelectorAll('.inc-segment--casing').length > 0 &&
  panes['io-segments'].querySelectorAll('.inc-segment--core').length > 0 &&
  panes['io-segments'].querySelectorAll('.inc-segment--dash').length > 0,
);
check('flow layer rendered to a canvas', !!panes['io-flow']?.querySelector('canvas'));
check('flow layer reports visible', flowLayer.visible === true);

/* -------------------------------------------------------------------- UI -- */

section('UI');
check('status bar mounted', !!window.document.querySelector('.statusbar'));
check('control panel mounted', !!window.document.querySelector('#control-panel-mount .panel'));
check('detail panel mounted', !!window.document.querySelector('#detail-panel-mount .panel'));
check('timeline mounted', !!window.document.querySelector('.timeline'));

check(
  'legend shows all four severities',
  window.document.querySelectorAll('.legend__sev').length === 4,
);
check(
  'severity filter chips rendered',
  window.document.querySelectorAll('.chip').length === 4,
);
check(
  'layer toggles rendered',
  window.document.querySelectorAll('.layer-row .switch input').length === 3,
);
check(
  'incident list rendered one row per visible incident',
  window.document.querySelectorAll('.inc-item').length === state.visibleIncidents.length,
);
check(
  'timeline ticks drawn for every incident',
  window.document.querySelectorAll('.timeline__tick').length > 0,
);

const activeValue = window.document.querySelector('.statusbar__value');
check('status bar shows a non-zero active count', Number(activeValue?.textContent) > 0, activeValue?.textContent);

/* -------------------------------------------------------- interactions --- */

section('Interaction');

// Selecting via the list should update the store, the layer and the panel.
const firstItem = window.document.querySelector('.inc-item');
firstItem.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await tick();

const selectedId = store.getState().selectedId;
check('clicking a list row selects that incident', !!selectedId, `selectedId=${selectedId}`);
check('detail view replaces the list', !!window.document.querySelector('.detail__banner'));
check(
  'selection is reflected in the URL hash',
  window.location.hash.includes(encodeURIComponent(selectedId)),
  window.location.hash,
);
check(
  'selected marker gets the selected modifier',
  !!window.document.querySelector('.inc-marker--selected'),
);

// Back button returns to the list.
window.document.querySelector('.detail__actions .btn:last-child')
  .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await tick();
check('back button clears the selection', store.getState().selectedId === null);
check('list view restored', !!window.document.querySelector('.inc-item'));

// Severity chip filtering.
const beforeFilter = store.getState().visibleIncidents.length;
const lowChip = Array.from(window.document.querySelectorAll('.chip'))
  .find((c) => c.textContent.trim() === 'Low');
lowChip.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await tick();
const afterFilter = store.getState().visibleIncidents.length;
check('deselecting a severity chip filters the list', afterFilter < beforeFilter, `${beforeFilter} → ${afterFilter}`);
check('chip reflects pressed state', lowChip.getAttribute('aria-pressed') === 'false');
lowChip.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await tick();
check('re-selecting restores the list', store.getState().visibleIncidents.length === beforeFilter);

// Guard: the user must not be able to filter every severity away.
for (const chip of window.document.querySelectorAll('.chip')) {
  chip.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
}
await tick();
check(
  'at least one severity always stays selected',
  store.getState().severities.size >= 1,
  `${store.getState().severities.size} selected`,
);
// restore
store.setState({ severities: new Set(['low', 'medium', 'high', 'closure']) });
await tick();

// Layer toggles.
const flowToggle = window.document.getElementById('toggle-showFlow');
flowToggle.checked = false;
flowToggle.dispatchEvent(new window.Event('change', { bubbles: true }));
await tick();
check('flow toggle hides the flow layer', flowLayer.visible === false);
flowToggle.checked = true;
flowToggle.dispatchEvent(new window.Event('change', { bubbles: true }));
await tick();
check('flow toggle restores the flow layer', flowLayer.visible === true);

// Cleared toggle should surface the cleared demo incident.
const clearedToggle = window.document.getElementById('toggle-showCleared');
clearedToggle.checked = true;
clearedToggle.dispatchEvent(new window.Event('change', { bubbles: true }));
await tick();
check(
  'including cleared surfaces the cleared incident',
  store.getState().visibleIncidents.some((i) => i.id === 'INC-2205'),
);
clearedToggle.checked = false;
clearedToggle.dispatchEvent(new window.Event('change', { bubbles: true }));
await tick();

// Search box.
const search = window.document.querySelector('input[type="search"]');
search.value = 'Avondale';
search.dispatchEvent(new window.Event('input', { bubbles: true }));
await tick();
check(
  'search narrows to matching roads',
  store.getState().visibleIncidents.every((i) => /avondale/i.test(i.road.name)),
  store.getState().visibleIncidents.map((i) => i.road.name).join(', '),
);
search.value = '';
search.dispatchEvent(new window.Event('input', { bubbles: true }));
await tick();

/* -------------------------------------------------------------- timeline -- */

section('Timeline');

const wallClock = store.getState().wallClock;
check('starts in live mode', store.getState().live === true);

const range = window.document.querySelector('.timeline__range');
const rewound = wallClock - 5 * 60 * 60 * 1000;   // 5 h ago
range.value = String(rewound);
range.dispatchEvent(new window.Event('input', { bubbles: true }));
await tick();

check('scrubbing leaves live mode', store.getState().live === false);
check(
  'scrubbing moves the evaluation instant',
  Math.abs(store.getState().evaluationTime - rewound) < 60_000,
);
check(
  'scrubbing back before the collision hides it',
  !store.getState().visibleIncidents.some((i) => i.id === 'INC-2201'),
  'INC-2201 starts ~41 min ago, so it should not exist 5 h back',
);

// Scrub forward onto a scheduled event. INC-2207 starts ~55 min out, which is
// inside the timeline's 2 h lookahead; INC-2202 starts at +3.2 h and is
// deliberately beyond the window, so the scrubber clamps before reaching it.
const forward = wallClock + 90 * 60 * 1000;
range.value = String(forward);
range.dispatchEvent(new window.Event('input', { bubbles: true }));
await tick();
check(
  'scrubbing forward activates a scheduled event',
  store.getState().visibleIncidents.some((i) => i.id === 'INC-2207'),
  store.getState().visibleIncidents.map((i) => i.id).join(', '),
);
check(
  'the scrubber clamps to the end of its window',
  store.getState().evaluationTime <= wallClock + 2 * 60 * 60 * 1000 + 60_000,
);

// LIVE pill returns to now.
window.document.querySelector('.live-pill')
  .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await tick();
check('LIVE pill returns to live mode', store.getState().live === true);
check(
  'live mode re-shows the current collision',
  store.getState().visibleIncidents.some((i) => i.id === 'INC-2201'),
);

/* ------------------------------------------------------------- shortcuts -- */

section('Keyboard');

function press(key) {
  window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key, bubbles: true }));
}

press(']');
await tick();
check('] selects the next incident', !!store.getState().selectedId);

const first = store.getState().selectedId;
press(']');
await tick();
check('] advances the selection', store.getState().selectedId !== first);

press('Escape');
await tick();
check('Escape clears the selection', store.getState().selectedId === null);

press('c');
await tick();
check('c toggles cleared incidents', store.getState().showCleared === true);
press('c');
await tick();

/* --------------------------------------------------------------- console -- */

section('Console');

// jsdom has no canvas, no layout engine and no network here. The flow layer
// uses a Canvas renderer by design (it has to scale to thousands of segments),
// so it cannot draw in this harness. These are harness limits, not app defects:
const HARNESS_NOISE = [
  /Could not load img/i,            // remote basemap tiles
  /Could not parse CSS/i,           // CSS custom properties / color-mix()
  /Not implemented/i,               // getContext('2d')
  /reading 'translate'/i,           // …and its knock-on inside L.Canvas._update
  /_removePath/i,                   // …and its knock-on during teardown
];

const realErrors = consoleErrors.filter((e) => {
  const text = String(e?.message ?? e);
  return !HARNESS_NOISE.some((pattern) => pattern.test(text));
});

check('no unexplained errors during boot or interaction', realErrors.length === 0,
  realErrors.slice(0, 3).map((e) => String(e?.message ?? e)).join('\n      '));

check(
  'canvas faults are contained by the store, not the feed',
  store.getState().feedState === 'ok',
  `feedState=${store.getState().feedState}`,
);

/* ---------------------------------------------------------------- report -- */

console.log(
  `\n${failures === 0 ? '[32m' : '[31m'}` +
  `${checks - failures}/${checks} checks passed[0m\n`,
);

process.exit(failures === 0 ? 0 : 1);

/* ------------------------------------------------------------------ util -- */

function tick(ms = 30) {
  return new Promise((r) => setTimeout(r, ms));
}
