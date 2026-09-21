import { definePlugin, h } from '@spot-canvas/sdk';

const FOCUS_SECONDS = 25 * 60;
const TICK_MS = 1000;

const CSS = `
.tb-timer { height: 100%; display: grid; place-items: center; padding: 12px; text-align: center; }
.tb-timer__clock { font-family: var(--mono); font-size: 34px; font-weight: 500; font-variant-numeric: tabular-nums; letter-spacing: -0.02em; }
.tb-timer__acts { display: flex; gap: 6px; margin-top: 8px; justify-content: center; }
`;

const format = (seconds: number) =>
  `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;

export default definePlugin({
  manifest: {
    apiVersion: 1,
    id: 'spotcanvas.timer',
    name: 'Focus timer',
    kind: 'widget',
    version: '0.1.0',
    size: [220, 150],
    permissions: ['events']
  },
  mount(host, api) {
    api.ui.style(CSS);
    let remaining = FOCUS_SECONDS;
    let handle: ReturnType<typeof setInterval> | null = null;

    const root = h('div', 'tb-timer');
    const inner = h('div');
    const clock = h('div', 'tb-timer__clock', format(remaining));
    const acts = h('div', 'tb-timer__acts');
    const start = h('button', 'tb-btn tb-btn--primary', 'Start');
    const reset = h('button', 'tb-btn', 'Reset');
    acts.append(start, reset);
    inner.append(clock, acts);
    root.append(inner);
    host.append(root);

    const stop = () => {
      if (handle !== null) clearInterval(handle);
      handle = null;
      start.textContent = 'Start';
    };

    start.onclick = () => {
      if (handle !== null) {
        stop();
        return;
      }
      start.textContent = 'Pause';
      handle = setInterval(() => {
        remaining = Math.max(0, remaining - 1);
        clock.textContent = format(remaining);
        if (remaining === 0) {
          stop();
          api.events.emit('timer:done');
        }
      }, TICK_MS);
    };

    reset.onclick = () => {
      stop();
      remaining = FOCUS_SECONDS;
      clock.textContent = format(remaining);
    };

    api.onUnmount(stop);
  }
});
