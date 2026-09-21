import { definePlugin, h } from '@spot-canvas/sdk';

interface State {
  text: string;
}

const CSS = `
.tb-note { height: 100%; }
.tb-note textarea { width: 100%; height: 100%; resize: none; border: 0; padding: 12px 14px; background: var(--note-bg); color: var(--note-ink); font: inherit; line-height: 1.55; display: block; }
.tb-note textarea:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
`;

export default definePlugin({
  manifest: {
    apiVersion: 1,
    id: 'spotcanvas.note',
    name: 'Sticky note',
    kind: 'widget',
    version: '0.1.0',
    size: [220, 160],
    permissions: ['storage']
  },
  mount(host, api) {
    api.ui.style(CSS);
    const state = api.storage.get<State>() ?? { text: '' };
    const root = h('div', 'tb-note');
    const area = h('textarea');
    area.value = state.text;
    area.placeholder = 'Write something…';
    area.setAttribute('aria-label', 'Note');
    area.oninput = () => {
      state.text = area.value;
      api.storage.set(state);
    };
    root.append(area);
    host.append(root);
  }
});
