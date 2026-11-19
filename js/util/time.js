/**
 * time.js — timestamp parsing, formatting and interval maths.
 * Pure functions; no DOM. Unit-tested in tests/time.test.mjs.
 */

import { LOCALE, TIME_ZONE } from '../config.js';

/** Milliseconds in useful units. */
export const MS = {
  second: 1000,
  minute: 60_000,
  hour: 3_600_000,
  day: 86_400_000,
};

/**
 * Parse anything timestamp-ish into epoch ms.
 * @param {string|number|Date|null|undefined} value
 * @returns {number|null} epoch ms, or null if unparseable
 */
export function toEpoch(value) {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) {
    const t = value.getTime();
    return Number.isNaN(t) ? null : t;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null;
    // Heuristic: 10-digit values are seconds, not ms.
    return value < 1e11 ? value * 1000 : value;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed === '') return null;

    // Microsoft/WCF date format used by some DOT feeds: /Date(1723000000000-0700)/
    const wcf = /^\/Date\((-?\d+)([+-]\d{4})?\)\/$/.exec(trimmed);
    if (wcf) return Number(wcf[1]);

    const parsed = Date.parse(trimmed);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

const _fmtCache = new Map();
function fmt(options) {
  const key = JSON.stringify(options);
  let f = _fmtCache.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat(LOCALE, { timeZone: TIME_ZONE, ...options });
    _fmtCache.set(key, f);
  }
  return f;
}

/** "7:04 AM" */
export function formatClock(epoch) {
  if (epoch == null) return '—';
  return fmt({ hour: 'numeric', minute: '2-digit' }).format(new Date(epoch));
}

/** "7:04:31 AM" */
export function formatClockSeconds(epoch) {
  if (epoch == null) return '—';
  return fmt({ hour: 'numeric', minute: '2-digit', second: '2-digit' }).format(new Date(epoch));
}

/** "Thu, Aug 6" */
export function formatDate(epoch) {
  if (epoch == null) return '—';
  return fmt({ weekday: 'short', month: 'short', day: 'numeric' }).format(new Date(epoch));
}

/** "Thu, Aug 6, 7:04 AM" */
export function formatDateTime(epoch) {
  if (epoch == null) return '—';
  return fmt({
    weekday: 'short', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit',
  }).format(new Date(epoch));
}

/**
 * Human duration from a millisecond span. Always non-negative.
 * 45s → "45s"; 96min → "1h 36m"; 26h → "1d 2h"
 */
export function formatDuration(ms) {
  const n = Math.abs(Math.round(Number(ms) || 0));
  if (n < MS.minute) return `${Math.round(n / MS.second)}s`;

  const totalMinutes = Math.round(n / MS.minute);
  if (totalMinutes < 60) return `${totalMinutes}m`;

  const totalHours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (totalHours < 24) return minutes ? `${totalHours}h ${minutes}m` : `${totalHours}h`;

  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  return hours ? `${days}d ${hours}h` : `${days}d`;
}

/**
 * "3m ago" / "in 12m" / "just now".
 * @param {number} epoch
 * @param {number} [now]
 */
export function formatRelative(epoch, now = Date.now()) {
  if (epoch == null) return '—';
  const delta = epoch - now;
  if (Math.abs(delta) < 30 * MS.second) return 'just now';
  const span = formatDuration(delta);
  return delta < 0 ? `${span} ago` : `in ${span}`;
}

/**
 * Does [startA, endA) overlap the instant `t`?
 * A null end means "open ended / still going".
 */
export function isActiveAt(start, end, t) {
  if (start == null) return false;
  if (t < start) return false;
  if (end == null) return true;
  return t < end;
}

/** Clamp a number into [min, max]. */
export function clamp(value, min, max) {
  if (Number.isNaN(value)) return min;
  return value < min ? min : value > max ? max : value;
}

/** Round an epoch down to the nearest `stepMs` boundary. */
export function snap(epoch, stepMs) {
  if (!stepMs) return epoch;
  return Math.floor(epoch / stepMs) * stepMs;
}
