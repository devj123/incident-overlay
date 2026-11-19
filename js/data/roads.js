/**
 * roads.js — corridor centrelines for the demo area (Redmond / SR 520, WA).
 *
 * NOTE: these polylines are hand-approximated for prototyping. They are close
 * enough to sit on the right roads at zoom 12–15 but they are NOT survey-grade
 * geometry. In production you would source centrelines from an LRS / OSM
 * extract and key segments by route + milepost.
 *
 * Coordinates are [lat, lng].
 */

/**
 * @typedef {object} Corridor
 * @property {string} id
 * @property {string} name
 * @property {string} shortName
 * @property {number} freeFlowMph
 * @property {number} lanes
 * @property {[number,number][]} path   ordered west→east or south→north
 */

/** @type {Corridor[]} */
export const CORRIDORS = [
  {
    id: 'sr520',
    name: 'SR 520',
    shortName: 'SR 520',
    freeFlowMph: 60,
    lanes: 3,
    path: [
      [47.6396, -122.1980],
      [47.6408, -122.1885],
      [47.6432, -122.1790],
      [47.6470, -122.1700],
      [47.6512, -122.1618],
      [47.6551, -122.1548],
      [47.6588, -122.1470],
      [47.6620, -122.1385],
      [47.6645, -122.1300],
      [47.6668, -122.1236],
    ],
  },
  {
    id: 'sr202',
    name: 'SR 202 / Redmond-Fall City Rd',
    shortName: 'SR 202',
    freeFlowMph: 45,
    lanes: 2,
    path: [
      [47.6745, -122.1248],
      [47.6706, -122.1218],
      [47.6664, -122.1182],
      [47.6612, -122.1122],
      [47.6558, -122.1052],
      [47.6502, -122.0984],
    ],
  },
  {
    id: 'redmond-way',
    name: 'Redmond Way',
    shortName: 'Redmond Way',
    freeFlowMph: 35,
    lanes: 2,
    path: [
      [47.6788, -122.1595],
      [47.6783, -122.1492],
      [47.6776, -122.1398],
      [47.6763, -122.1320],
      [47.6748, -122.1262],
    ],
  },
  {
    id: 'avondale',
    name: 'Avondale Rd NE',
    shortName: 'Avondale Rd',
    freeFlowMph: 40,
    lanes: 2,
    path: [
      [47.6722, -122.1198],
      [47.6778, -122.1188],
      [47.6842, -122.1176],
      [47.6908, -122.1163],
    ],
  },
  {
    id: '148th',
    name: '148th Ave NE',
    shortName: '148th Ave NE',
    freeFlowMph: 35,
    lanes: 2,
    path: [
      [47.6248, -122.1462],
      [47.6392, -122.1460],
      [47.6534, -122.1458],
      [47.6676, -122.1455],
      [47.6822, -122.1452],
    ],
  },
  {
    id: '156th',
    name: '156th Ave NE',
    shortName: '156th Ave NE',
    freeFlowMph: 35,
    lanes: 2,
    path: [
      [47.6296, -122.1332],
      [47.6438, -122.1328],
      [47.6580, -122.1324],
      [47.6712, -122.1320],
    ],
  },
  {
    id: 'willows',
    name: 'Willows Rd NE',
    shortName: 'Willows Rd',
    freeFlowMph: 40,
    lanes: 2,
    path: [
      [47.6702, -122.1452],
      [47.6796, -122.1432],
      [47.6884, -122.1412],
      [47.6962, -122.1396],
    ],
  },
  {
    id: 'wlsp',
    name: 'W Lake Sammamish Pkwy NE',
    shortName: 'W Lk Sammamish Pkwy',
    freeFlowMph: 35,
    lanes: 2,
    path: [
      [47.6534, -122.1082],
      [47.6448, -122.1058],
      [47.6362, -122.1036],
      [47.6278, -122.1018],
    ],
  },
];

/** Look up a corridor by id. */
export function getCorridor(id) {
  return CORRIDORS.find((c) => c.id === id) ?? null;
}
