/**
 * main.js — composition root.
 *
 * Wires: source → poller → store → (layers + UI). Nothing else imports
 * anything else's internals; every module here is handed exactly the
 * collaborators it needs.
 */

import { MAP, SEVERITY_ORDER, TIMELINE } from './config.js';
import { createStore } from './core/store.js';
import { createMockSource, createPoller } from './data/sources.js';
import { filterIncidents, compareIncidents } from './data/incident.js';
import { createFlowLayer } from './layers/flowLayer.js';
import { createIncidentLayer } from './layers/incidentLayer.js';
import { createControlPanel } from './ui/controlPanel.js';
import { createDetailPanel } from './ui/detailPanel.js';
import { createTimeline } from './ui/timeline.js';
import { createStatusBar } from './ui/statusBar.js';
import { toast, rafThrottle } from './util/dom.js';

/* ------------------------------------------------------------------ guard -- */

if (typeof L === 'undefined') {
  document.getElementById('map').innerHTML =
    '<p style="padding:24px;font:14px system-ui">Leaflet failed to load. ' +
    'Check that <code>vendor/leaflet/leaflet.js</code> is present.</p>';
  throw new Error('Leaflet not loaded');
}

/* ------------------------------------------------------------------ store -- */

const now = Date.now();

const store = createStore({
  /** raw feed output */
  incidents: [],
  flow: [],
  issues: [],
  dropped: 0,

  /** derived */
  visibleIncidents: [],

  /** selection */
  selectedId: null,
  hoveredId: null,

  /** filters */
  severities: new Set(SEVERITY_ORDER),
  query: '',
  showCleared: false,

  /** layer visibility */
  showFlow: true,
  showIncidents: true,

  /** time */
  live: true,
  wallClock: now,
  evaluationTime: now,

  /** feed health */
  feedState: 'idle',
  fetchedAt: null,
});

/* -------------------------------------------------------------------- map -- */

const map = L.map('map', {
  center: MAP.center,
  zoom: MAP.zoom,
  minZoom: MAP.minZoom,
  maxZoom: MAP.maxZoom,
  maxBounds: MAP.maxBounds,
  maxBoundsViscosity: MAP.maxBoundsViscosity,
  zoomControl: true,
  preferCanvas: false,
  worldCopyJump: false,
});

const prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches;

L.tileLayer(prefersDark ? MAP.basemap.darkUrl : MAP.basemap.url, {
  subdomains: MAP.basemap.subdomains,
  maxZoom: MAP.basemap.maxZoom,
  attribution: MAP.basemap.attribution,
  detectRetina: true,
}).addTo(map);

// Dedicated panes give explicit control over stacking order.
// Leaflet defaults: tiles 200, overlay 400, shadow 500, marker 600, tooltip 650.
const PANES = {
  flow: 'io-flow',
  segments: 'io-segments',
  markers: 'io-markers',
};

map.createPane(PANES.flow).style.zIndex = '390';
map.getPane(PANES.flow).style.pointerEvents = 'none';
map.createPane(PANES.segments).style.zIndex = '420';
map.createPane(PANES.markers).style.zIndex = '620';

/* ----------------------------------------------------------------- layers -- */

const flowLayer = createFlowLayer({ map, pane: PANES.flow });

const incidentLayer = createIncidentLayer({
  map,
  segmentPane: PANES.segments,
  markerPane: PANES.markers,
  onSelect: (id) => selectIncident(id),
  onHover: (id) => store.setState({ hoveredId: id }),
});

/* -------------------------------------------------------------- selection -- */

function selectIncident(id) {
  const current = store.getState().selectedId;
  store.setState({ selectedId: current === id ? null : id });
}

/* -------------------------------------------------------------- derivation -- */

/**
 * Recompute `visibleIncidents` from the raw feed plus the active filters.
 * Keeps array identity stable when the result is unchanged so that dependent
 * views don't re-render for nothing.
 */
function recomputeVisible() {
  const state = store.getState();

  const next = filterIncidents(state.incidents, {
    severities: state.severities,
    query: state.query,
    includeCleared: state.showCleared,
    at: state.evaluationTime,
  }).sort(compareIncidents);

  const prev = state.visibleIncidents;
  const same =
    prev.length === next.length &&
    prev.every((inc, i) => inc === next[i]);

  if (!same) store.setState({ visibleIncidents: next });
}

for (const key of ['incidents', 'severities', 'query', 'showCleared', 'evaluationTime']) {
  store.select((s) => s[key], recomputeVisible);
}

/* -------------------------------------- push derived state into the layers -- */

store.select((s) => s.visibleIncidents, (incidents) => {
  incidentLayer.update(incidents, { at: store.getState().evaluationTime });
});

store.select((s) => s.evaluationTime, (t) => {
  incidentLayer.setTime(t);
});

store.select((s) => s.flow, (flow) => {
  flowLayer.update(flow);
});

store.select((s) => s.showFlow, (v) => flowLayer.setVisible(v));
store.select((s) => s.showIncidents, (v) => incidentLayer.setVisible(v));
store.select((s) => s.selectedId, (id) => {
  incidentLayer.setSelected(id);
  writeHash(id);
});
store.select((s) => s.hoveredId, (id) => incidentLayer.setHovered(id));

/* ---------------------------------------------------------------------- UI -- */

const statusBar = createStatusBar({
  store,
  onRefresh: () => {
    poller.refresh();
    toast('Refreshing feed…', 1400);
  },
});
document.getElementById('status-bar-mount').appendChild(statusBar.root);

const controlPanel = createControlPanel({ store });
document.getElementById('control-panel-mount').appendChild(controlPanel.root);

const detailPanel = createDetailPanel({
  store,
  onSelect: (id) => store.setState({ selectedId: id }),
  onHover: (id) => store.setState({ hoveredId: id }),
  onFocus: (id) => incidentLayer.focus(id),
});
document.getElementById('detail-panel-mount').appendChild(detailPanel.root);

const timeline = createTimeline({ store });
document.getElementById('timeline-mount').appendChild(timeline.root);

/* ------------------------------------------------------------------- feed -- */

const source = createMockSource({
  latencyMs: 300,
  includeMalformed: new URLSearchParams(location.search).has('malformed'),
});

const poller = createPoller({
  source,
  onData: ({ incidents, flow, issues, dropped, fetchedAt }) => {
    store.setState({ incidents, flow, issues, dropped, fetchedAt });

    if (issues.length) {
      console.groupCollapsed(
        `[feed] ${issues.length} record(s) with issues, ${dropped} dropped`,
      );
      for (const entry of issues) console.warn(entry.id ?? '(no id)', entry.issues);
      console.groupEnd();
    }
  },
  onStateChange: (feedState, detail) => {
    store.setState({ feedState });
    if (feedState === 'error') {
      console.error('[feed]', detail);
      toast('Feed unavailable — retrying');
    }
  },
});

poller.start();

/* ------------------------------------------------------------- wall clock -- */

// One shared ticker. In LIVE mode it also advances the evaluation instant.
setInterval(() => {
  const wallClock = Date.now();
  const patch = { wallClock };
  if (store.getState().live) patch.evaluationTime = wallClock;
  store.setState(patch);
}, 1000);

/* ------------------------------------------------- cursor position readout -- */

const readout = document.getElementById('map-readout');
const updateReadout = rafThrottle((e) => {
  readout.textContent = `${e.latlng.lat.toFixed(5)}, ${e.latlng.lng.toFixed(5)}`;
});
map.on('mousemove', updateReadout);
map.on('mouseout', () => { readout.textContent = ''; });

// Clicking empty map clears the selection.
map.on('click', () => store.setState({ selectedId: null }));

/* --------------------------------------------------------- deep linking --- */

function writeHash(id) {
  const target = id ? `#incident=${encodeURIComponent(id)}` : '#';
  if (location.hash !== target) {
    history.replaceState(null, '', target);
  }
}

function readHash() {
  const match = /#incident=([^&]+)/.exec(location.hash);
  return match ? decodeURIComponent(match[1]) : null;
}

// Apply the initial deep link once the first payload lands.
let deepLinkApplied = false;
store.select((s) => s.incidents, (incidents) => {
  if (deepLinkApplied || incidents.length === 0) return;
  deepLinkApplied = true;

  const wanted = readHash();
  if (wanted && incidents.some((i) => i.id === wanted)) {
    store.setState({ selectedId: wanted });
    incidentLayer.focus(wanted);
  }
});

/* -------------------------------------------------------------- shortcuts -- */

const SHORTCUTS = {
  Escape: () => store.setState({ selectedId: null }),
  f: () => { incidentLayer.fitAll(); toast('Fit to all incidents', 1200); },
  l: () => { timeline.goLive(); toast('Following live time', 1200); },
  r: () => { poller.refresh(); toast('Refreshing feed…', 1200); },
  c: () => {
    const next = !store.getState().showCleared;
    store.setState({ showCleared: next });
    toast(next ? 'Showing past & planned' : 'Showing live only', 1400);
  },
};

document.addEventListener('keydown', (event) => {
  // Don't hijack typing.
  const tag = event.target?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || event.target?.isContentEditable) {
    if (event.key === 'Escape') event.target.blur();
    return;
  }
  if (event.metaKey || event.ctrlKey || event.altKey) return;

  const handler = SHORTCUTS[event.key];
  if (handler) {
    event.preventDefault();
    handler();
  }

  // [ and ] step through the incident list.
  if (event.key === '[' || event.key === ']') {
    event.preventDefault();
    const { visibleIncidents, selectedId } = store.getState();
    if (visibleIncidents.length === 0) return;
    const idx = visibleIncidents.findIndex((i) => i.id === selectedId);
    const delta = event.key === ']' ? 1 : -1;
    const nextIdx = idx === -1
      ? (delta === 1 ? 0 : visibleIncidents.length - 1)
      : (idx + delta + visibleIncidents.length) % visibleIncidents.length;
    const next = visibleIncidents[nextIdx];
    store.setState({ selectedId: next.id });
    incidentLayer.focus(next.id);
  }
});

/* ------------------------------------------------------------------ debug -- */

// Handy in the console while prototyping; not required by anything.
window.__overlay = { map, store, incidentLayer, flowLayer, poller, PANES, TIMELINE };

console.info(
  '%c Incident Overlay ',
  'background:#0b7285;color:#fff;border-radius:3px',
  '\nShortcuts: F fit · L live · R refresh · C cleared · [ ] prev/next · Esc deselect' +
  '\nAdd ?malformed to the URL to exercise the feed validator.',
);
