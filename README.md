# Incident Overlay — prototype

A traffic incident overlay: colour-coded flow segments, incident geometry with
severity markers, a detail panel, and a time scrubber that re-renders the whole
map "as of" any instant in a rolling window.

No build step, no framework. Vanilla ES modules + Leaflet (vendored).

---

## Run it

ES modules can't load over `file://`, so serve the folder. Easiest in VS Code:
right-click `index.html` → **Open with Live Server** (the extension is in
`.vscode/extensions.json`, so VS Code will offer to install it).

Otherwise, from a terminal in the project root:

```bash
npx serve -l 5173 .            # any OS, needs Node
python3 -m http.server 5173    # macOS / Linux
python  -m http.server 5173    # Windows
# → http://localhost:5173
```

There are also VS Code tasks (`Ctrl/Cmd+Shift+P` → *Run Task*) for serving,
testing and regenerating the sample feed, and launch configs that start a
server and open Chrome or Edge with the debugger attached (`F5`).

(If you open `index.html` directly you'll get a card telling you all this
rather than a blank page.)

The only network dependency at runtime is the basemap tiles from CARTO.
Leaflet itself is vendored in `vendor/`, so the overlay still draws offline —
you just get a grey background.

---

## What's in it

**Map layers**

- **Flow layer** — per-segment speeds bucketed into clear / moving / slow /
  stop-and-go. Rendered on a **Canvas** renderer, because a real network is
  thousands of segments and one SVG path each doesn't scale.
- **Incident layer** — rendered on the **SVG** renderer, because these need CSS
  classes for the marching-ants animation and hover transitions, and there are
  tens of them, not thousands. Each incident draws as:
  - a dark **casing** underneath, so the overlay reads against any basemap
  - a severity-coloured **core**
  - an animated **dash** overlay while the incident is live
  - a **marker badge** at the anchor point, pulsing for active high/closure

**Interaction**

- Click a marker, a segment, or a list row to select; the detail panel shows
  lanes blocked, duration, ETA, milepost, and provenance.
- Selection is written to the URL hash, so `#incident=INC-2201` deep-links.
- Severity chips, a keyword filter, and layer toggles, all driven off one store.

**Time scrubbing**

The whole app renders as of `evaluationTime`. In **LIVE** mode that tracks the
wall clock; scrubbing pins it. Incident status, duration, and visibility are all
recomputed against that instant — scrub back an hour and the collision hasn't
happened yet. Ticks under the scrubber mark when each incident started.

**Keyboard**

| Key | Action |
|---|---|
| `F` | Fit to all incidents |
| `L` | Return to live |
| `R` | Refresh the feed |
| `C` | Toggle past & planned incidents |
| `[` `]` | Previous / next incident |
| `Esc` | Deselect |

---

## Layout

```
index.html            mount points only; components build their own DOM
css/app.css           design tokens + component styles, light and dark
js/
  config.js           enums, colour scales, tunables — no DOM, unit-testable
  core/store.js       ~90-line observable store with selector subscriptions
  data/
    incident.js       the canonical Incident record + normalizer + filters
    sources.js        feed adapters (mock, HTTP) + poller with backoff
    mockFeed.js       synthetic records, deliberately messy
    roads.js          corridor centrelines for the demo area
  layers/
    flowLayer.js      canvas speed segments
    incidentLayer.js  SVG geometry + DivIcon markers
    icons.js          inline SVG glyph set
  ui/                 controlPanel, detailPanel, timeline, statusBar, legend
  util/               dom, time, geo helpers
tests/                unit + integration
tools/                smoke harness, sample-data generator
```

### The one architectural idea

Everything downstream consumes **one shape** — the `Incident` record in
`data/incident.js` — and nothing else. Feed adapters are the only code allowed
to know what a particular agency's JSON looks like; they run raw records
through `normalizeIncident`, which is deliberately forgiving about input and
strict about output.

That normalizer accepts the vocabularies feeds actually use (`crash`,
`roadwork`, `MINOR`, numeric 1–4 severity ranks, `/Date(…)/ ` timestamps,
four different ways of expressing a coordinate) and either produces a clean
record or reports *why* it couldn't:

```js
normalizeIncident(raw) // → { incident: Incident|null, issues: string[] }
```

Bad data becomes a logged issue, not a crash three modules later. Load the page
with `?malformed` to watch it reject two records and repair a third.

---

## Swapping in a real feed

`main.js` builds one source and hands it to the poller. That's the whole seam:

```js
// js/main.js
const source = createMockSource({ latencyMs: 300 });
```

Point it at HTTP instead:

```js
import { createHttpSource } from './data/sources.js';

const source = createHttpSource({
  url: 'data/incidents.sample.json',
});
```

If the payload isn't already `{ incidents: [...] }`, supply an extractor —
this is the only place that needs to know the upstream shape:

```js
const source = createHttpSource({
  url: 'https://example.gov/api/traffic/v2/events',
  headers: { 'X-Api-Key': KEY },
  extract: (payload) => ({
    incidents: payload.data.events,
    flow: payload.data.speedSegments,
  }),
});
```

Everything downstream — layers, list, detail panel, scrubber — is unchanged,
because it only ever sees normalized records.

`data/incidents.sample.json` exists so the HTTP path has something realistic to
point at. Timestamps are anchored to when it was generated; regenerate with
`npm run gen:sample` when it goes stale.

---

## Tests

```bash
npm test        # 53 assertions: geo, time, store, normalizer, adapters, poller
npm run smoke   # boots the whole app in jsdom, 67 DOM-level checks
npm run check   # both
```

`npm run smoke` needs `jsdom` (`npm i`). It loads `index.html`, evaluates the
real vendored Leaflet inside the jsdom window, imports `main.js`, waits for the
feed, then asserts on the DOM that comes out: panes at the right z-indices,
one marker per visible incident, casing/core/dash all present, closure markers
painted near-black, ARIA labels on markers, chips and toggles wired, scrubbing
hiding the collision, `[`/`]` walking the list, and so on.

Three real bugs came out of writing it, all fixed:

1. **A rendering fault was being reported as a feed outage.** A layer throwing
   inside a store subscriber propagated back through `setState` into the
   poller's `try`, which marked the feed errored. `createStore` now isolates
   subscriber faults (`tests/integration.test.mjs`).
2. **The poller required a DOM.** It reached for `document` to pause on
   tab-hide, so it crashed under Node. Now degrades gracefully.
3. **A mislabelled control.** "Include cleared" also reveals *scheduled*
   incidents — renamed to "Past & planned".

### What the harness can't tell you

jsdom has no layout engine and no canvas. So the smoke test verifies structure,
wiring, and state, but **not** that anything looks right — no pixel positions,
no z-order-as-rendered, and the flow layer can't actually paint (its canvas has
no 2D context). Those checks are filtered out explicitly rather than silently.
Look at it in a browser before trusting the visuals.

---

## Caveats

- **Road geometry is hand-approximated.** The corridor centrelines in
  `data/roads.js` sit on roughly the right roads at zoom 12–15, but they are not
  survey-grade. Real systems key segments to a linear referencing system
  (route + milepost) and pull centrelines from an LRS or OSM extract.
- **All incident data is synthetic.** `mockFeed.js` generates it relative to
  whenever you load the page. Nothing here reflects real conditions.
- **Congestion is modelled, not measured.** `buildFlowSamples` shapes speeds
  around active incidents — a queue upstream, free-flow downstream — because
  that's what makes the overlay legible. It's a plausible-looking function, not
  traffic science.

---

## Licence

Leaflet in `vendor/leaflet/` is BSD-2-Clause, © Volodymyr Agafonkin and
CloudMade — see `vendor/leaflet/LICENSE`. Basemap tiles © OpenStreetMap
contributors, © CARTO.
