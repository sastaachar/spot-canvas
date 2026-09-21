import { definePlugin, h } from '@spot-canvas/sdk';

interface State {
  url: string;
}

const CSS = `
.tb-emb { display: flex; flex-direction: column; height: 100%; }
.tb-emb form { display: flex; gap: 6px; padding: 8px; border-bottom: 1px solid var(--border); }
.tb-emb input { flex: 1; min-width: 0; height: 28px; border: 1px solid var(--border); border-radius: 4px; padding: 0 8px; background: var(--bg); color: var(--ink); font-family: var(--mono); font-size: 11.5px; }
.tb-emb iframe { flex: 1; width: 100%; border: 0; background: var(--surface); }
.tb-emb__hint { padding: 6px 8px 0; color: var(--negative); font-size: 12px; }
`;

const PLACEHOLDER = `<body style="margin:0;display:grid;place-items:center;height:100vh;font:13px system-ui,sans-serif;color:#6B655D;background:#F5F2ED;text-align:center;padding:16px">
<div><div style="font-size:15px;color:#2B2926;margin-bottom:4px">Any URL goes here</div>Enter an address above and press Load.</div></body>`;

function normalise(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  try {
    const url = new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null;
  } catch {
    return null;
  }
}

export default definePlugin({
  manifest: {
    apiVersion: 1,
    id: 'spotcanvas.embed',
    name: 'Web embed',
    kind: 'embed',
    version: '0.1.0',
    size: [420, 300],
    permissions: ['storage', 'network']
  },
  mount(host, api) {
    api.ui.style(CSS);
    const state = api.storage.get<State>() ?? { url: '' };

    const root = h('div', 'tb-emb');
    const form = h('form');
    const input = h('input');
    input.type = 'text';
    input.placeholder = 'https://example.com';
    input.value = state.url;
    input.setAttribute('aria-label', 'URL to embed');
    const go = h('button', 'tb-btn tb-btn--primary', 'Load');
    go.type = 'submit';
    form.append(input, go);

    const hint = h('div', 'tb-emb__hint');
    hint.hidden = true;

    const frame = h('iframe');
    frame.title = 'Embedded page';
    frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-popups');
    frame.setAttribute('referrerpolicy', 'no-referrer');

    root.append(form, hint, frame);
    host.append(root);

    const load = () => {
      if (state.url) {
        frame.removeAttribute('srcdoc');
        frame.src = state.url;
      } else {
        frame.removeAttribute('src');
        frame.srcdoc = PLACEHOLDER;
      }
    };

    form.onsubmit = (e) => {
      e.preventDefault();
      const url = normalise(input.value);
      if (url === null) {
        hint.textContent = 'Only http and https addresses can be embedded.';
        hint.hidden = false;
        return;
      }
      hint.hidden = true;
      state.url = url;
      input.value = url;
      api.storage.set(state);
      load();
    };

    load();
  }
});
