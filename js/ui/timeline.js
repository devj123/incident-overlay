/**
 * timeline.js — bottom scrubber.
 *
 * Drives `evaluationTime`: the instant the whole app is rendered "as of".
 * In LIVE mode it tracks wall-clock; scrubbing drops out of LIVE and pins the
 * app to a fixed instant so you can see what the network looked like then.
 */

import { el } from '../util/dom.js';
import { GLYPH } from '../layers/icons.js';
import { TIMELINE, SEVERITY } from '../config.js';
import { formatClock, formatDate, clamp, snap } from '../util/time.js';

/**
 * @param {{ store: ReturnType<import('../core/store.js').createStore> }} opts
 */
export function createTimeline({ store }) {
  const range = el('input', {
    type: 'range',
    class: 'timeline__range',
    min: '0',
    max: '1',
    step: String(TIMELINE.stepMs),
    'aria-label': 'Scrub map time',
  });

  const ticks = el('div', { class: 'timeline__ticks', 'aria-hidden': 'true' });

  const timeLabel = el('span', { class: 'timeline__time' }, '—');
  const dateLabel = el('span', { class: 'timeline__date' }, '');

  const livePill = el('button', {
    type: 'button',
    class: 'live-pill',
    dataset: { live: 'true' },
    'aria-pressed': 'true',
    title: 'Follow the current time',
    onclick: () => goLive(),
  },
    el('span', { class: 'live-pill__dot' }),
    'LIVE',
  );

  const playBtn = el('button', {
    type: 'button',
    class: 'icon-btn',
    'aria-label': 'Play through the time window',
    html: GLYPH.play,
    onclick: () => togglePlay(),
  });

  const stepBackBtn = el('button', {
    type: 'button',
    class: 'icon-btn',
    'aria-label': 'Step back 5 minutes',
    html: GLYPH.chevronLeft,
    onclick: () => nudge(-TIMELINE.playbackStepMs),
  });

  const stepFwdBtn = el('button', {
    type: 'button',
    class: 'icon-btn',
    'aria-label': 'Step forward 5 minutes',
    html: GLYPH.chevronRight,
    onclick: () => nudge(TIMELINE.playbackStepMs),
  });

  const root = el('div', { class: 'timeline', role: 'group', 'aria-label': 'Time controls' },
    el('div', { class: 'timeline__controls' }, playBtn, stepBackBtn, stepFwdBtn),
    el('div', { class: 'timeline__scrub' },
      el('div', { class: 'timeline__track-bg' }),
      ticks,
      range,
    ),
    el('div', { class: 'timeline__readout' }, timeLabel, dateLabel, livePill),
  );

  /* ------------------------------------------------------------- window --- */

  let windowStart = 0;
  let windowEnd = 1;
  let playTimer = null;

  function recomputeWindow() {
    const now = store.getState().wallClock;
    windowStart = snap(now - TIMELINE.lookbackMs, TIMELINE.stepMs);
    windowEnd = snap(now + TIMELINE.lookaheadMs, TIMELINE.stepMs);
    range.min = String(windowStart);
    range.max = String(windowEnd);
  }

  /* ---------------------------------------------------------------- act --- */

  function goLive() {
    stopPlay();
    store.setState({ live: true, evaluationTime: store.getState().wallClock });
  }

  function scrubTo(t) {
    const clamped = clamp(t, windowStart, windowEnd);
    store.setState({ live: false, evaluationTime: clamped });
  }

  function nudge(deltaMs) {
    scrubTo(store.getState().evaluationTime + deltaMs);
  }

  function togglePlay() {
    if (playTimer) stopPlay();
    else startPlay();
  }

  function startPlay() {
    stopPlay();
    // Playing from the "now" edge would immediately hit the wall; rewind first.
    if (store.getState().evaluationTime >= windowEnd - TIMELINE.playbackStepMs) {
      scrubTo(windowStart);
    }
    playBtn.innerHTML = GLYPH.pause;
    playBtn.setAttribute('aria-label', 'Pause playback');
    playTimer = setInterval(() => {
      const next = store.getState().evaluationTime + TIMELINE.playbackStepMs;
      if (next >= windowEnd) {
        scrubTo(windowEnd);
        stopPlay();
        return;
      }
      scrubTo(next);
    }, TIMELINE.playbackIntervalMs);
  }

  function stopPlay() {
    if (!playTimer) return;
    clearInterval(playTimer);
    playTimer = null;
    playBtn.innerHTML = GLYPH.play;
    playBtn.setAttribute('aria-label', 'Play through the time window');
  }

  range.addEventListener('input', (e) => {
    stopPlay();
    scrubTo(Number(e.currentTarget.value));
  });

  /* -------------------------------------------------------------- ticks --- */

  function renderTicks() {
    const { incidents } = store.getState();
    const span = windowEnd - windowStart;
    ticks.replaceChildren();
    if (span <= 0) return;

    for (const incident of incidents) {
      const pct = ((incident.startTime - windowStart) / span) * 100;
      if (pct < 0 || pct > 100) continue;
      ticks.appendChild(el('span', {
        class: 'timeline__tick',
        style: {
          left: `${pct}%`,
          background: SEVERITY[incident.severity]?.color ?? '#888',
        },
      }));
    }
  }

  /* ------------------------------------------------------------- render --- */

  function render() {
    const { evaluationTime, live } = store.getState();
    range.value = String(evaluationTime);
    timeLabel.textContent = formatClock(evaluationTime);
    dateLabel.textContent = formatDate(evaluationTime);
    livePill.dataset.live = String(live);
    livePill.setAttribute('aria-pressed', String(live));
    range.setAttribute('aria-valuetext', `${formatDate(evaluationTime)}, ${formatClock(evaluationTime)}`);
  }

  const unsubscribers = [
    store.select((s) => s.evaluationTime, render),
    store.select((s) => s.live, render),
    store.select((s) => s.wallClock, () => { recomputeWindow(); render(); }),
    store.select((s) => s.incidents, renderTicks),
  ];

  recomputeWindow();
  renderTicks();
  render();

  return {
    root,
    goLive,
    destroy() {
      stopPlay();
      unsubscribers.forEach((fn) => fn());
    },
  };
}
