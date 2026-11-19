/**
 * statusBar.js — header right: counts, feed health, manual refresh.
 */

import { el } from '../util/dom.js';
import { GLYPH } from '../layers/icons.js';
import { SEVERITY } from '../config.js';
import { formatClockSeconds, formatRelative } from '../util/time.js';

const CONN_LABEL = {
  idle: 'Idle',
  loading: 'Updating…',
  ok: 'Connected',
  error: 'Feed error',
};

/**
 * @param {{
 *   store: ReturnType<import('../core/store.js').createStore>,
 *   onRefresh: ()=>void,
 * }} opts
 */
export function createStatusBar({ store, onRefresh }) {
  const activeValue = el('span', { class: 'statusbar__value' }, '0');
  const worstValue = el('span', { class: 'statusbar__value' }, '—');
  const updatedValue = el('span', { class: 'statusbar__value' }, '—');

  const connDot = el('span', { class: 'statusbar__conn-dot' });
  const connLabel = el('span', {}, CONN_LABEL.idle);
  const conn = el('span', {
    class: 'statusbar__conn',
    dataset: { state: 'idle' },
  }, connDot, connLabel);

  const refreshBtn = el('button', {
    type: 'button',
    class: 'icon-btn',
    'aria-label': 'Refresh feed now',
    title: 'Refresh feed now',
    html: GLYPH.refresh,
    onclick: onRefresh,
  });

  const root = el('div', { class: 'statusbar' },
    el('span', { class: 'statusbar__group' },
      el('span', { class: 'statusbar__label' }, 'Active'), activeValue),
    el('span', { class: 'statusbar__group' },
      el('span', { class: 'statusbar__label' }, 'Worst'), worstValue),
    el('span', { class: 'statusbar__group' },
      el('span', { class: 'statusbar__label' }, 'Updated'), updatedValue),
    conn,
    refreshBtn,
  );

  function render() {
    const { visibleIncidents, evaluationTime, feedState, fetchedAt } = store.getState();

    const active = visibleIncidents.filter((i) => {
      if (i.startTime > evaluationTime) return false;
      return i.endTime === null || i.endTime > evaluationTime;
    });

    activeValue.textContent = String(active.length);

    let worst = null;
    for (const inc of active) {
      const rank = SEVERITY[inc.severity].rank;
      if (!worst || rank > SEVERITY[worst].rank) worst = inc.severity;
    }
    worstValue.textContent = worst ? SEVERITY[worst].label : '—';
    worstValue.style.color = worst ? SEVERITY[worst].color : '';

    updatedValue.textContent = fetchedAt ? formatClockSeconds(fetchedAt) : '—';
    updatedValue.title = fetchedAt ? formatRelative(fetchedAt) : '';

    conn.dataset.state = feedState;
    connLabel.textContent = CONN_LABEL[feedState] ?? feedState;
  }

  const unsubscribers = [
    store.select((s) => s.visibleIncidents, render),
    store.select((s) => s.evaluationTime, render),
    store.select((s) => s.feedState, render),
    store.select((s) => s.fetchedAt, render),
  ];

  render();

  return {
    root,
    render,
    destroy() { unsubscribers.forEach((fn) => fn()); },
  };
}
