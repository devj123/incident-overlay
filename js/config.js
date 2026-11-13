/**
 * config.js — single source of truth for enums, colour scales and tunables.
 *
 * Keep this free of DOM/Leaflet imports so it can be unit-tested under Node.
 */

/* ---------------------------------------------------------------- map ---- */

export const MAP = {
  /** Redmond / SR 520 east end — matches the demo dataset. */
  center: [47.6605, -122.1490],
  zoom: 13,
  minZoom: 9,
  maxZoom: 18,

  /** Hard bounds so the demo can't be panned into the ocean. */
  maxBounds: [
    [47.40, -122.55],
    [47.90, -121.85],
  ],
  maxBoundsViscosity: 0.6,

  basemap: {
    url: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
    darkUrl: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    subdomains: 'abcd',
    maxZoom: 20,
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
  },
};

/* ------------------------------------------------------------ severity ---- */

/**
 * Ordered low → high. `rank` drives z-ordering and list sort.
 * Colours mirror the CSS custom properties in app.css — keep them in sync.
 */
export const SEVERITY = {
  low:     { id: 'low',     rank: 1, label: 'Low',       color: '#f2c214', ink: '#3a2f00', weight: 5 },
  medium:  { id: 'medium',  rank: 2, label: 'Medium',    color: '#f08a24', ink: '#ffffff', weight: 6 },
  high:    { id: 'high',    rank: 3, label: 'High',      color: '#d32f2f', ink: '#ffffff', weight: 7 },
  closure: { id: 'closure', rank: 4, label: 'Closure',   color: '#1f2429', ink: '#ffffff', weight: 8 },
};

export const SEVERITY_ORDER = ['low', 'medium', 'high', 'closure'];

/* ---------------------------------------------------------------- flow ---- */

export const FLOW = {
  clear:    { id: 'clear',    label: 'Clear',       color: '#16b98b', weight: 4 },
  moving:   { id: 'moving',   label: 'Moving',      color: '#86cf6a', weight: 4 },
  slow:     { id: 'slow',     label: 'Slow',        color: '#f0a12e', weight: 4.5 },
  stopgo:   { id: 'stopgo',   label: 'Stop & Go',   color: '#e01b4c', weight: 5 },
  unknown:  { id: 'unknown',  label: 'No data',     color: '#b6c0c9', weight: 3 },
};

export const FLOW_ORDER = ['clear', 'moving', 'slow', 'stopgo', 'unknown'];

/**
 * Speed ratio (observed / free-flow) → flow bucket.
 * Thresholds are inclusive of the lower bound.
 */
export const FLOW_THRESHOLDS = [
  { min: 0.80, id: 'clear' },
  { min: 0.55, id: 'moving' },
  { min: 0.30, id: 'slow' },
  { min: 0.00, id: 'stopgo' },
];

/* ----------------------------------------------------------------- types -- */

export const INCIDENT_TYPES = {
  collision:    { id: 'collision',    label: 'Collision' },
  disabled:     { id: 'disabled',     label: 'Disabled vehicle' },
  construction: { id: 'construction', label: 'Construction' },
  closure:      { id: 'closure',      label: 'Road closure' },
  hazard:       { id: 'hazard',       label: 'Road hazard' },
  weather:      { id: 'weather',      label: 'Weather' },
  event:        { id: 'event',        label: 'Special event' },
  other:        { id: 'other',        label: 'Other' },
};

export const INCIDENT_STATUS = {
  active:    { id: 'active',    label: 'Active' },
  scheduled: { id: 'scheduled', label: 'Scheduled' },
  cleared:   { id: 'cleared',   label: 'Cleared' },
};

/* ---------------------------------------------------------------- layers -- */

/** Rendering knobs for the incident geometry. */
export const SEGMENT_STYLE = {
  /** Dark casing drawn under the coloured core, for contrast on any basemap. */
  casingColor: '#101820',
  casingOpacity: 0.32,
  casingExtra: 5,          // px added to the core weight
  coreOpacity: 0.95,
  selectedExtra: 3,        // px added when selected
  dashArray: '10 14',      // marching-ants pattern for active incidents
};

export const MARKER_SIZE = {
  low: 22,
  medium: 24,
  high: 27,
  closure: 27,
};

/* ----------------------------------------------------------------- time ---- */

export const TIMELINE = {
  /** Window shown by the scrubber, relative to "now". */
  lookbackMs:  6 * 60 * 60 * 1000,
  lookaheadMs: 2 * 60 * 60 * 1000,
  /** Scrubber granularity. */
  stepMs: 60 * 1000,
  /** Playback speed multiplier and frame interval. */
  playbackStepMs: 5 * 60 * 1000,
  playbackIntervalMs: 220,
};

/* ---------------------------------------------------------------- polling -- */

export const FEED = {
  /** How often the live source is re-polled. */
  pollIntervalMs: 30_000,
  /** Abort a feed request after this long. */
  timeoutMs: 8_000,
  /** Retry backoff schedule, ms. */
  retryBackoffMs: [1_000, 3_000, 8_000],
};

export const LOCALE = 'en-US';
export const TIME_ZONE = 'America/Los_Angeles';
