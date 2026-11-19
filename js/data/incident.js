/**
 * incident.js — the canonical Incident record.
 *
 * Everything downstream (layers, list, detail panel) consumes this shape and
 * nothing else. Feed adapters are responsible for producing it via
 * `normalizeIncident`, which is deliberately forgiving about input and strict
 * about output: anything it can't make sense of becomes a validation issue
 * rather than a runtime crash three modules later.
 *
 * Pure JS; unit-tested in tests/incident.test.mjs.
 */

import { SEVERITY, SEVERITY_ORDER, INCIDENT_TYPES, INCIDENT_STATUS } from '../config.js';
import { toEpoch, isActiveAt } from '../util/time.js';
import { isValidLatLng, lineLength, midpoint, bounds } from '../util/geo.js';

/**
 * @typedef {object} Incident
 * @property {string}   id
 * @property {string}   type          one of INCIDENT_TYPES
 * @property {string}   severity      one of SEVERITY_ORDER
 * @property {string}   status        active | scheduled | cleared
 * @property {string}   headline
 * @property {string}   description
 * @property {{name:string, direction:string|null, mpStart:number|null, mpEnd:number|null}} road
 * @property {[number,number]} location   marker anchor [lat, lng]
 * @property {[number,number][]} geometry affected segment (may be empty)
 * @property {{total:number|null, blocked:number, note:string}} lanes
 * @property {number}   startTime     epoch ms
 * @property {number|null} endTime    epoch ms, null = ongoing
 * @property {number|null} estimatedClearTime
 * @property {number}   lastUpdated
 * @property {string}   source
 * @property {string|null} reportedBy
 * @property {number}   lengthMeters  derived
 * @property {object}   raw           original feed record, kept for debugging
 */

const REQUIRED_STRING_FIELDS = ['id'];

/** Coerce to a trimmed string, or '' */
function str(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  const s = String(value).trim();
  return s === '' ? fallback : s;
}

/** Coerce to a finite number, or null */
function num(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Coerce to a non-negative integer, or 0 */
function count(value) {
  const n = num(value);
  if (n === null || n < 0) return 0;
  return Math.floor(n);
}

/**
 * Map an arbitrary severity-ish input onto the canonical scale.
 * Accepts our own ids, common DOT vocabularies, and 1–4 numeric ranks.
 */
export function coerceSeverity(value) {
  if (value === null || value === undefined) return null;

  const n = Number(value);
  if (Number.isFinite(n) && n >= 1 && n <= 4) return SEVERITY_ORDER[Math.round(n) - 1];

  const key = String(value).trim().toLowerCase().replace(/[\s_-]+/g, '');
  const table = {
    low: 'low', minor: 'low', minimal: 'low', info: 'low', '1': 'low',
    medium: 'medium', moderate: 'medium', mid: 'medium', '2': 'medium',
    high: 'high', major: 'high', severe: 'high', serious: 'high', '3': 'high',
    closure: 'closure', closed: 'closure', fullclosure: 'closure',
    roadclosed: 'closure', blocked: 'closure', critical: 'closure', '4': 'closure',
  };
  return table[key] ?? null;
}

/** Map an arbitrary type-ish input onto the canonical type vocabulary. */
export function coerceType(value) {
  if (value === null || value === undefined) return null;
  const key = String(value).trim().toLowerCase().replace(/[\s_-]+/g, '');
  const table = {
    collision: 'collision', crash: 'collision', accident: 'collision', wreck: 'collision',
    disabled: 'disabled', disabledvehicle: 'disabled', stalled: 'disabled', breakdown: 'disabled',
    construction: 'construction', roadwork: 'construction', maintenance: 'construction', work: 'construction',
    closure: 'closure', closed: 'closure', roadclosure: 'closure',
    hazard: 'hazard', debris: 'hazard', obstruction: 'hazard', spill: 'hazard',
    weather: 'weather', snow: 'weather', ice: 'weather', flooding: 'weather',
    event: 'event', specialevent: 'event',
    other: 'other', unknown: 'other',
  };
  return table[key] ?? null;
}

/** Map an arbitrary status-ish input onto active | scheduled | cleared. */
export function coerceStatus(value) {
  if (value === null || value === undefined) return null;
  const key = String(value).trim().toLowerCase().replace(/[\s_-]+/g, '');
  const table = {
    active: 'active', open: 'active', ongoing: 'active', inprogress: 'active', current: 'active',
    scheduled: 'scheduled', planned: 'scheduled', upcoming: 'scheduled', future: 'scheduled',
    cleared: 'cleared', closed: 'cleared', resolved: 'cleared', complete: 'cleared',
    completed: 'cleared', past: 'cleared', archived: 'cleared',
  };
  return table[key] ?? null;
}

/**
 * Derive a status from the time window when the feed doesn't supply one.
 * @param {number} start
 * @param {number|null} end
 * @param {number} now
 */
export function deriveStatus(start, end, now) {
  if (start != null && now < start) return 'scheduled';
  if (end != null && now >= end) return 'cleared';
  return 'active';
}

/**
 * Normalize one raw feed record into an Incident.
 *
 * @param {object} raw
 * @param {{ now?: number, source?: string }} [ctx]
 * @returns {{ incident: Incident|null, issues: string[] }}
 */
export function normalizeIncident(raw, ctx = {}) {
  const issues = [];
  const now = ctx.now ?? Date.now();

  if (!raw || typeof raw !== 'object') {
    return { incident: null, issues: ['record is not an object'] };
  }

  /* --- identity ------------------------------------------------------- */
  const id = str(raw.id ?? raw.Id ?? raw.incidentId ?? raw.EventID ?? raw.AlertID);
  for (const field of REQUIRED_STRING_FIELDS) {
    if (field === 'id' && !id) issues.push('missing id');
  }
  if (!id) return { incident: null, issues };

  /* --- classification -------------------------------------------------- */
  let type = coerceType(raw.type ?? raw.EventCategory ?? raw.category);
  if (!type) {
    if (raw.type !== undefined) issues.push(`unrecognised type "${raw.type}" → other`);
    type = 'other';
  }

  let severity = coerceSeverity(raw.severity ?? raw.Priority ?? raw.priority);
  if (!severity) {
    if (raw.severity !== undefined) issues.push(`unrecognised severity "${raw.severity}" → medium`);
    severity = type === 'closure' ? 'closure' : 'medium';
  }

  /* --- timing ---------------------------------------------------------- */
  const startTime = toEpoch(raw.startTime ?? raw.StartTime ?? raw.start ?? raw.reported);
  const endTime = toEpoch(raw.endTime ?? raw.EndTime ?? raw.end);
  const estimatedClearTime = toEpoch(raw.estimatedClearTime ?? raw.eta ?? raw.EstimatedClear);
  const lastUpdated = toEpoch(raw.lastUpdated ?? raw.LastUpdatedTime ?? raw.updated) ?? startTime ?? now;

  if (startTime === null) {
    issues.push('missing or unparseable startTime');
    return { incident: null, issues };
  }
  if (endTime !== null && endTime < startTime) {
    issues.push('endTime precedes startTime — dropping endTime');
  }
  const safeEnd = endTime !== null && endTime >= startTime ? endTime : null;

  let status = coerceStatus(raw.status);
  if (!status) {
    if (raw.status !== undefined) issues.push(`unrecognised status "${raw.status}" → derived`);
    status = deriveStatus(startTime, safeEnd, now);
  }

  /* --- geometry -------------------------------------------------------- */
  const rawGeometry = raw.geometry ?? raw.polyline ?? raw.path ?? [];
  const geometry = Array.isArray(rawGeometry)
    ? rawGeometry.filter(isValidLatLng).map(([lat, lng]) => [lat, lng])
    : [];
  if (Array.isArray(rawGeometry) && rawGeometry.length !== geometry.length) {
    issues.push(`dropped ${rawGeometry.length - geometry.length} invalid geometry point(s)`);
  }

  let location = null;
  const rawLoc = raw.location ?? raw.point ?? null;
  if (Array.isArray(rawLoc) && isValidLatLng(rawLoc)) {
    location = [rawLoc[0], rawLoc[1]];
  } else if (rawLoc && isValidLatLng([num(rawLoc.lat), num(rawLoc.lng ?? rawLoc.lon ?? rawLoc.long)])) {
    location = [num(rawLoc.lat), num(rawLoc.lng ?? rawLoc.lon ?? rawLoc.long)];
  } else if (isValidLatLng([num(raw.lat ?? raw.Latitude), num(raw.lng ?? raw.lon ?? raw.Longitude)])) {
    location = [num(raw.lat ?? raw.Latitude), num(raw.lng ?? raw.lon ?? raw.Longitude)];
  } else if (geometry.length > 0) {
    // Deriving the anchor from the line is the designed fallback for feeds that
    // publish geometry without a separate point — not a data problem.
    location = midpoint(geometry);
  }

  if (!location) {
    issues.push('no usable location or geometry');
    return { incident: null, issues };
  }

  /* --- road / lanes ---------------------------------------------------- */
  const roadSrc = raw.road ?? {};
  const road = {
    name: str(roadSrc.name ?? raw.roadName ?? raw.RoadwayName, 'Unknown road'),
    direction: str(roadSrc.direction ?? raw.direction ?? raw.DirectionOfTravel) || null,
    mpStart: num(roadSrc.mpStart ?? roadSrc.milepostStart ?? raw.milepost),
    mpEnd: num(roadSrc.mpEnd ?? roadSrc.milepostEnd),
  };

  const laneSrc = raw.lanes ?? {};
  const lanes = {
    total: num(laneSrc.total ?? raw.totalLanes),
    blocked: count(laneSrc.blocked ?? raw.lanesBlocked),
    note: str(laneSrc.note ?? laneSrc.description ?? raw.lanesAffected),
  };
  if (lanes.total !== null && lanes.blocked > lanes.total) {
    issues.push('lanes.blocked exceeds lanes.total — clamping');
    lanes.blocked = lanes.total;
  }

  /* --- text ------------------------------------------------------------ */
  const headline = str(
    raw.headline ?? raw.title ?? raw.HeadlineDescription,
    `${INCIDENT_TYPES[type].label} on ${road.name}`,
  );
  const description = str(raw.description ?? raw.Description ?? raw.detail);

  /* --- assemble -------------------------------------------------------- */
  /** @type {Incident} */
  const incident = {
    id,
    type,
    severity,
    status,
    headline,
    description,
    road,
    location,
    geometry,
    lanes,
    startTime,
    endTime: safeEnd,
    estimatedClearTime,
    lastUpdated,
    source: str(ctx.source ?? raw.source, 'unknown'),
    reportedBy: str(raw.reportedBy ?? raw.agency) || null,
    lengthMeters: geometry.length > 1 ? lineLength(geometry) : 0,
    raw,
  };

  return { incident, issues };
}

/**
 * Normalize a whole feed, collecting per-record issues.
 * @param {object[]} records
 * @param {{ now?: number, source?: string }} [ctx]
 * @returns {{ incidents: Incident[], issues: {id:string|null, issues:string[]}[], dropped:number }}
 */
export function normalizeFeed(records, ctx = {}) {
  const incidents = [];
  const issues = [];
  let dropped = 0;

  for (const record of Array.isArray(records) ? records : []) {
    const { incident, issues: recIssues } = normalizeIncident(record, ctx);
    if (recIssues.length) {
      issues.push({ id: incident?.id ?? (record && record.id) ?? null, issues: recIssues });
    }
    if (incident) incidents.push(incident);
    else dropped += 1;
  }

  // Stable ordering: severity desc, then most recently updated first.
  incidents.sort(compareIncidents);
  return { incidents, issues, dropped };
}

/** Sort comparator: most urgent first. */
export function compareIncidents(a, b) {
  const rankDelta = SEVERITY[b.severity].rank - SEVERITY[a.severity].rank;
  if (rankDelta !== 0) return rankDelta;

  const statusWeight = { active: 0, scheduled: 1, cleared: 2 };
  const statusDelta = statusWeight[a.status] - statusWeight[b.status];
  if (statusDelta !== 0) return statusDelta;

  return b.lastUpdated - a.lastUpdated;
}

/** Is the incident live at instant `t`? */
export function isIncidentActiveAt(incident, t) {
  return isActiveAt(incident.startTime, incident.endTime, t);
}

/**
 * Recompute status against a given instant. Used by the time scrubber so the
 * badge reads correctly when you scrub into the past or future.
 */
export function statusAt(incident, t) {
  return deriveStatus(incident.startTime, incident.endTime, t);
}

/** How long the incident had been open at instant `t` (ms, >= 0). */
export function durationAt(incident, t) {
  const end = incident.endTime ?? t;
  return Math.max(0, Math.min(end, t) - incident.startTime);
}

/**
 * Apply the UI filter set.
 * @param {Incident[]} incidents
 * @param {{ severities?:Set<string>|string[], types?:Set<string>|string[],
 *           at?:number|null, includeCleared?:boolean, query?:string }} filters
 */
export function filterIncidents(incidents, filters = {}) {
  const severities = filters.severities ? new Set(filters.severities) : null;
  const types = filters.types ? new Set(filters.types) : null;
  const query = (filters.query || '').trim().toLowerCase();
  const at = filters.at ?? null;

  return incidents.filter((inc) => {
    if (severities && !severities.has(inc.severity)) return false;
    if (types && !types.has(inc.type)) return false;

    if (at !== null) {
      const live = isIncidentActiveAt(inc, at);
      if (!live && !filters.includeCleared) return false;
    } else if (!filters.includeCleared && inc.status === 'cleared') {
      return false;
    }

    if (query) {
      const haystack = `${inc.road.name} ${inc.road.direction ?? ''} ${inc.headline} ${inc.description}`.toLowerCase();
      if (!haystack.includes(query)) return false;
    }
    return true;
  });
}

/** Leaflet-ready bounds covering every incident passed in. */
export function incidentBounds(incidents) {
  const points = [];
  for (const inc of incidents) {
    points.push(inc.location);
    for (const pt of inc.geometry) points.push(pt);
  }
  return bounds(points);
}

/** Counts by severity, always including every key. */
export function countBySeverity(incidents) {
  const out = Object.fromEntries(SEVERITY_ORDER.map((s) => [s, 0]));
  for (const inc of incidents) out[inc.severity] += 1;
  return out;
}

/** Human summary of blocked lanes, e.g. "2 of 3 lanes blocked". */
export function describeLanes(lanes) {
  if (!lanes) return null;
  if (lanes.note) return lanes.note;
  if (!lanes.blocked) return lanes.total ? 'All lanes open' : null;
  if (lanes.total) return `${lanes.blocked} of ${lanes.total} lanes blocked`;
  return `${lanes.blocked} lane${lanes.blocked === 1 ? '' : 's'} blocked`;
}

export { INCIDENT_STATUS };
