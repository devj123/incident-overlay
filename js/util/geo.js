/**
 * geo.js — geometry helpers.
 *
 * Coordinates are `[lat, lng]` pairs throughout (Leaflet's convention), NOT
 * GeoJSON's `[lng, lat]`. `fromGeoJSON` handles the swap at the boundary.
 *
 * Pure functions; no DOM. Unit-tested in tests/geo.test.mjs.
 */

const EARTH_RADIUS_M = 6_371_008.8;
const DEG = Math.PI / 180;

/** @typedef {[number, number]} LatLng */

/** Is this a plausible [lat, lng] pair? */
export function isValidLatLng(pt) {
  return (
    Array.isArray(pt) &&
    pt.length >= 2 &&
    Number.isFinite(pt[0]) && Number.isFinite(pt[1]) &&
    pt[0] >= -90 && pt[0] <= 90 &&
    pt[1] >= -180 && pt[1] <= 180
  );
}

/**
 * Great-circle distance in metres (haversine).
 * @param {LatLng} a
 * @param {LatLng} b
 */
export function distance(a, b) {
  const dLat = (b[0] - a[0]) * DEG;
  const dLng = (b[1] - a[1]) * DEG;
  const lat1 = a[0] * DEG;
  const lat2 = b[0] * DEG;

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);

  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Total length of a polyline in metres.
 * @param {LatLng[]} line
 */
export function lineLength(line) {
  if (!Array.isArray(line) || line.length < 2) return 0;
  let total = 0;
  for (let i = 1; i < line.length; i += 1) total += distance(line[i - 1], line[i]);
  return total;
}

/**
 * Point at a given fraction (0..1) along a polyline, measured by arc length.
 * Returns null for degenerate input.
 * @param {LatLng[]} line
 * @param {number} fraction
 * @returns {LatLng|null}
 */
export function pointAlong(line, fraction) {
  if (!Array.isArray(line) || line.length === 0) return null;
  if (line.length === 1) return [line[0][0], line[0][1]];

  const total = lineLength(line);
  if (total === 0) return [line[0][0], line[0][1]];

  const target = Math.max(0, Math.min(1, fraction)) * total;
  let travelled = 0;

  for (let i = 1; i < line.length; i += 1) {
    const segLen = distance(line[i - 1], line[i]);
    if (travelled + segLen >= target) {
      const t = segLen === 0 ? 0 : (target - travelled) / segLen;
      return [
        line[i - 1][0] + (line[i][0] - line[i - 1][0]) * t,
        line[i - 1][1] + (line[i][1] - line[i - 1][1]) * t,
      ];
    }
    travelled += segLen;
  }
  const last = line[line.length - 1];
  return [last[0], last[1]];
}

/** Midpoint of a polyline by arc length. */
export function midpoint(line) {
  return pointAlong(line, 0.5);
}

/**
 * Axis-aligned bounds of a set of points.
 * @param {LatLng[]} points
 * @returns {{south:number,west:number,north:number,east:number}|null}
 */
export function bounds(points) {
  const valid = (points || []).filter(isValidLatLng);
  if (valid.length === 0) return null;

  let south = Infinity, west = Infinity, north = -Infinity, east = -Infinity;
  for (const [lat, lng] of valid) {
    if (lat < south) south = lat;
    if (lat > north) north = lat;
    if (lng < west) west = lng;
    if (lng > east) east = lng;
  }
  return { south, west, north, east };
}

/** Union of several bounds objects. */
export function unionBounds(list) {
  const present = (list || []).filter(Boolean);
  if (present.length === 0) return null;
  return present.reduce((acc, b) => ({
    south: Math.min(acc.south, b.south),
    west:  Math.min(acc.west,  b.west),
    north: Math.max(acc.north, b.north),
    east:  Math.max(acc.east,  b.east),
  }));
}

/** Bounds → Leaflet's `[[south, west], [north, east]]`. */
export function toLeafletBounds(b) {
  if (!b) return null;
  return [[b.south, b.west], [b.north, b.east]];
}

/**
 * Compass bearing a→b, degrees clockwise from north (0..360).
 */
export function bearing(a, b) {
  const lat1 = a[0] * DEG;
  const lat2 = b[0] * DEG;
  const dLng = (b[1] - a[1]) * DEG;

  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);

  return (Math.atan2(y, x) / DEG + 360) % 360;
}

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

/** Bearing degrees → "NE" etc. */
export function compassPoint(deg) {
  const idx = Math.round(((deg % 360) + 360) % 360 / 45) % 8;
  return COMPASS[idx];
}

/**
 * Extract the sub-line between two fractions of the total length.
 * Useful for rendering "milepost 6.2 to 7.8" style partial segments.
 * @param {LatLng[]} line
 * @param {number} from 0..1
 * @param {number} to   0..1
 * @returns {LatLng[]}
 */
export function sliceLine(line, from, to) {
  if (!Array.isArray(line) || line.length < 2) return Array.isArray(line) ? [...line] : [];

  let lo = Math.max(0, Math.min(1, from));
  let hi = Math.max(0, Math.min(1, to));
  if (lo > hi) [lo, hi] = [hi, lo];
  if (lo === hi) {
    const p = pointAlong(line, lo);
    return p ? [p, p] : [];
  }

  const total = lineLength(line);
  if (total === 0) return [line[0], line[line.length - 1]];

  const startDist = lo * total;
  const endDist = hi * total;

  const out = [];
  let travelled = 0;
  let started = false;

  for (let i = 1; i < line.length; i += 1) {
    const a = line[i - 1];
    const b = line[i];
    const segLen = distance(a, b);
    const segStart = travelled;
    const segEnd = travelled + segLen;

    if (!started && segEnd >= startDist) {
      const t = segLen === 0 ? 0 : (startDist - segStart) / segLen;
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
      started = true;
    }

    if (started) {
      if (segEnd >= endDist) {
        const t = segLen === 0 ? 0 : (endDist - segStart) / segLen;
        out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
        break;
      }
      out.push([b[0], b[1]]);
    }
    travelled = segEnd;
  }

  return out;
}

/**
 * GeoJSON LineString/Point coordinates → [lat, lng] pairs.
 * @param {number[]|number[][]} coords
 */
export function fromGeoJSON(coords) {
  if (!Array.isArray(coords)) return [];
  if (typeof coords[0] === 'number') {
    return isValidLatLng([coords[1], coords[0]]) ? [[coords[1], coords[0]]] : [];
  }
  return coords
    .map((c) => (Array.isArray(c) ? [c[1], c[0]] : null))
    .filter(isValidLatLng);
}

/** Metres → "1.4 mi" / "820 ft" */
export function formatDistance(metres) {
  const miles = metres / 1609.344;
  if (miles < 0.19) return `${Math.round(metres * 3.28084 / 10) * 10} ft`;
  return `${miles.toFixed(miles < 10 ? 1 : 0)} mi`;
}
