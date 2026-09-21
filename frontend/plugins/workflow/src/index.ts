import { definePlugin, h } from '@spot-canvas/sdk';

interface Step {
  title: string;
  detail: string;
}

interface State {
  current: number;
}

const STEPS: Step[] = [
  { title: 'Cut the branch', detail: 'Create release/1.0 from main and push it.' },
  { title: 'Run the smoke suite', detail: 'All 12 smoke tests must pass on the release branch.' },
  { title: 'Write release notes', detail: 'Summarise merged PRs since the last tag.' },
  { title: 'Tag and publish', detail: 'Tag v1.0.0, publish the build, announce in #releases.' }
];

const CSS = `
.tb-wf { padding: 12px 14px; display: grid; gap: 10px; font-size: 13px; }
.tb-wf__prog { height: 3px; background: var(--border); border-radius: 2px; overflow: hidden; }
.tb-wf__prog i { display: block; height: 100%; background: var(--accent); transition: width 200ms ease; }
.tb-wf ol { margin: 0; padding: 0; list-style: none; display: grid; gap: 4px; }
.tb-wf li { display: grid; grid-template-columns: 20px 1fr; gap: 8px; align-items: baseline; padding: 4px 6px; border-radius: 4px; color: var(--muted); }
.tb-wf li.is-current { color: var(--ink); background: var(--surface-2); }
.tb-wf li.is-done { text-decoration: line-through; }
.tb-wf__index { font-family: var(--mono); font-size: 11px; }
.tb-wf__step { padding: 10px 12px; border: 1px solid var(--border); border-radius: 4px; }
.tb-wf__step h4 { margin: 0 0 4px; font-size: 13px; font-weight: 500; }
.tb-wf__step p { margin: 0; color: var(--muted); font-size: 12px; }
.tb-wf__acts { display: flex; justify-content: space-between; gap: 8px; }
`;

export default definePlugin({
  manifest: {
    apiVersion: 1,
    id: 'spotcanvas.workflow',
    name: 'Release checklist',
    kind: 'workflow',
    version: '0.1.0',
    size: [320, 300],
    permissions: ['storage', 'events']
  },
  mount(host, api) {
    api.ui.style(CSS);
    const state = api.storage.get<State>() ?? { current: 0 };
    const root = h('div', 'tb-wf');
    host.append(root);

    const render = () => {
      root.replaceChildren();
      const done = state.current >= STEPS.length;

      const prog = h('div', 'tb-wf__prog');
      const bar = h('i');
      bar.style.width = `${(Math.min(state.current, STEPS.length) / STEPS.length) * 100}%`;
      prog.append(bar);

      const list = h('ol');
      STEPS.forEach((step, i) => {
        const li = h('li', i < state.current ? 'is-done' : i === state.current ? 'is-current' : '');
        li.append(h('span', 'tb-wf__index', i < state.current ? '✓' : String(i + 1).padStart(2, '0')), h('span', undefined, step.title));
        list.append(li);
      });

      const card = h('div', 'tb-wf__step');
      const active = STEPS[state.current];
      card.append(
        h('h4', undefined, active ? active.title : 'All steps complete'),
        h('p', undefined, active ? active.detail : 'Reset to run the checklist again.')
      );

      const acts = h('div', 'tb-wf__acts');
      const back = h('button', 'tb-btn', 'Back');
      back.disabled = state.current === 0;
      back.onclick = () => commit(Math.max(0, state.current - 1));
      const next = h('button', 'tb-btn tb-btn--primary', done ? 'Reset' : state.current === STEPS.length - 1 ? 'Finish' : 'Mark done, next');
      next.onclick = () => commit(done ? 0 : state.current + 1);
      acts.append(back, next);

      root.append(prog, list, card, acts);
    };

    const commit = (current: number) => {
      state.current = current;
      api.storage.set(state);
      api.events.emit('workflow:step', { step: current, total: STEPS.length });
      render();
    };

    render();
  }
});
