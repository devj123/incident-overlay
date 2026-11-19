/**
 * detailPanel.js — right rail.
 *
 * Two modes in one panel:
 *   • nothing selected → scrollable incident list, sorted most-urgent-first
 *   • one selected     → full detail card with a back affordance
 */

import { el, replaceChildren } from '../util/dom.js';
import { SEVERITY, INCIDENT_TYPES } from '../config.js';
import { GLYPH, glyphForType } from '../layers/icons.js';
import {
  statusAt, durationAt, describeLanes,
} from '../data/incident.js';
import {
  formatClock, formatDateTime, formatDuration, formatRelative,
} from '../util/time.js';
import { formatDistance } from '../util/geo.js';

/**
 * @param {{
 *   store: ReturnType<import('../core/store.js').createStore>,
 *   onSelect: (id:string|null)=>void,
 *   onHover: (id:string|null)=>void,
 *   onFocus: (id:string)=>void,
 * }} opts
 */
export function createDetailPanel({ store, onSelect, onHover, onFocus }) {
  const title = el('h2', { class: 'panel__title' }, 'Incidents');
  const countBadge = el('span', { class: 'layer-row__count' }, '0');

  const backBtn = el('button', {
    type: 'button',
    class: 'icon-btn',
    'aria-label': 'Back to incident list',
    html: GLYPH.chevronLeft,
    onclick: () => onSelect(null),
  });
  backBtn.style.display = 'none';

  const body = el('div', { class: 'panel__body' });

  const root = el('section', { class: 'panel', 'aria-label': 'Incident details' },
    el('header', { class: 'panel__header' },
      backBtn,
      title,
      el('span', { class: 'panel__spacer' }),
      countBadge,
    ),
    body,
  );

  /* --------------------------------------------------------------- list --- */

  function renderList(incidents, at) {
    if (incidents.length === 0) {
      replaceChildren(body, el('p', { class: 'empty-state' },
        'No incidents match the current filters.'));
      return;
    }

    const list = el('div', { class: 'inc-list', role: 'list' });

    for (const incident of incidents) {
      const spec = SEVERITY[incident.severity];
      const status = statusAt(incident, at);
      const typeLabel = INCIDENT_TYPES[incident.type]?.label ?? 'Incident';

      const item = el('button', {
        type: 'button',
        class: 'inc-item',
        role: 'listitem',
        'aria-current': String(incident.id === store.getState().selectedId),
        dataset: { id: incident.id },
        onclick: () => onSelect(incident.id),
        onmouseenter: () => onHover(incident.id),
        onmouseleave: () => onHover(null),
        onfocus: () => onHover(incident.id),
        onblur: () => onHover(null),
      },
        el('span', {
          class: 'inc-item__badge',
          style: { background: spec.color },
          html: glyphForType(incident.type),
          'aria-hidden': 'true',
        }),
        el('span', { class: 'inc-item__main' },
          el('span', { class: 'inc-item__road' },
            `${incident.road.name}${incident.road.direction ? ` · ${incident.road.direction}` : ''}`),
          el('span', { class: 'inc-item__headline' }, incident.headline),
          el('span', { class: 'inc-item__meta' },
            el('span', { class: `tag tag--${status}` }, status),
            el('span', {}, typeLabel),
            el('span', {}, '·'),
            el('span', {}, status === 'scheduled'
              ? formatRelative(incident.startTime, at)
              : formatDuration(durationAt(incident, at))),
          ),
        ),
      );

      list.appendChild(item);
    }

    replaceChildren(body, list);
  }

  /* ------------------------------------------------------------- detail --- */

  function renderDetail(incident, at) {
    const spec = SEVERITY[incident.severity];
    const status = statusAt(incident, at);
    const typeLabel = INCIDENT_TYPES[incident.type]?.label ?? 'Incident';
    const laneText = describeLanes(incident.lanes);

    const banner = el('div', {
      class: 'detail__banner',
      style: { background: spec.color, color: spec.ink },
    },
      el('span', {
        class: 'detail__banner-icon',
        html: glyphForType(incident.type),
        'aria-hidden': 'true',
      }),
      el('span', { class: 'detail__banner-text' },
        el('span', { class: 'detail__banner-type' }, `${spec.label} · ${typeLabel}`),
        el('span', { class: 'detail__banner-road' },
          `${incident.road.name}${incident.road.direction ? ` · ${incident.road.direction}` : ''}`),
      ),
    );

    const rows = [];
    const pushRow = (k, v) => { if (v !== null && v !== undefined && v !== '') rows.push([k, v]); };

    pushRow('Status', el('span', { class: `tag tag--${status}` }, status));
    pushRow('Reported', `${formatClock(incident.startTime)} · ${formatRelative(incident.startTime, at)}`);

    if (status === 'active') {
      pushRow('Open for', formatDuration(durationAt(incident, at)));
      if (incident.estimatedClearTime) {
        pushRow('Est. clear', `${formatClock(incident.estimatedClearTime)} · ${formatRelative(incident.estimatedClearTime, at)}`);
      }
    } else if (status === 'cleared' && incident.endTime) {
      pushRow('Cleared', `${formatClock(incident.endTime)} · ${formatRelative(incident.endTime, at)}`);
      pushRow('Total duration', formatDuration(incident.endTime - incident.startTime));
    } else if (status === 'scheduled') {
      pushRow('Starts', formatDateTime(incident.startTime));
      if (incident.endTime) pushRow('Ends', formatDateTime(incident.endTime));
    }

    if (incident.road.mpStart !== null) {
      pushRow('Milepost', incident.road.mpEnd !== null
        ? `${incident.road.mpStart} – ${incident.road.mpEnd}`
        : String(incident.road.mpStart));
    }
    if (incident.lengthMeters > 0) pushRow('Affected', formatDistance(incident.lengthMeters));
    if (incident.reportedBy) pushRow('Source', incident.reportedBy);
    pushRow('Updated', formatRelative(incident.lastUpdated, at));
    pushRow('ID', el('code', { style: { fontSize: '11.5px' } }, incident.id));

    const kv = el('div', { class: 'kv' },
      rows.flatMap(([k, v]) => [
        el('span', { class: 'kv__k' }, k),
        el('span', { class: 'kv__v' }, v),
      ]),
    );

    // Lane occupancy strip
    let laneBlock = null;
    if (incident.lanes.total) {
      const cells = [];
      for (let i = 0; i < incident.lanes.total; i += 1) {
        cells.push(el('span', {
          class: `lane-bar__cell${i < incident.lanes.blocked ? ' lane-bar__cell--blocked' : ''}`,
        }));
      }
      laneBlock = el('div', { class: 'panel__section' },
        el('h3', { class: 'panel__section-title' }, 'Lanes'),
        el('div', {}, laneText ?? '—'),
        el('div', { class: 'lane-bar', role: 'img', 'aria-label': laneText ?? 'Lane status' }, cells),
      );
    } else if (laneText) {
      laneBlock = el('div', { class: 'panel__section' },
        el('h3', { class: 'panel__section-title' }, 'Lanes'),
        el('div', {}, laneText),
      );
    }

    const actions = el('div', { class: 'detail__actions' },
      el('button', {
        type: 'button',
        class: 'btn btn--primary',
        onclick: () => onFocus(incident.id),
      }, 'Zoom to incident'),
      el('button', {
        type: 'button',
        class: 'btn',
        onclick: () => onSelect(null),
      }, 'Back to list'),
    );

    replaceChildren(body,
      banner,
      el('div', { class: 'detail__headline' }, incident.headline),
      incident.description ? el('div', { class: 'detail__desc' }, incident.description) : null,
      kv,
      laneBlock,
      actions,
    );
  }

  /* ------------------------------------------------------------- render --- */

  function render() {
    const state = store.getState();
    const { visibleIncidents, selectedId, evaluationTime } = state;

    const selected = selectedId
      ? visibleIncidents.find((i) => i.id === selectedId) ?? null
      : null;

    if (selected) {
      title.textContent = 'Incident detail';
      backBtn.style.display = '';
      countBadge.style.display = 'none';
      renderDetail(selected, evaluationTime);
      body.scrollTop = 0;
    } else {
      title.textContent = 'Incidents';
      backBtn.style.display = 'none';
      countBadge.style.display = '';
      countBadge.textContent = String(visibleIncidents.length);
      renderList(visibleIncidents, evaluationTime);
    }
  }

  const unsubscribers = [
    store.select((s) => s.visibleIncidents, render),
    store.select((s) => s.selectedId, render),
    store.select((s) => s.evaluationTime, render),
  ];

  render();

  return {
    root,
    render,
    destroy() { unsubscribers.forEach((fn) => fn()); },
  };
}
