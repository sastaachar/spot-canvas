import { definePlugin, h } from '@spot-canvas/sdk';

interface Link {
  label: string;
  url: string;
}

interface State {
  items: Link[];
}

const MAX_LINKS = 30;
const MAX_LABEL = 60;

const CSS = `
.tb-links { height: 100%; display: flex; flex-direction: column; }
.tb-links__list { list-style: none; margin: 0; padding: 6px 0; flex: 1; overflow: auto; }
.tb-links__item { display: flex; align-items: center; gap: 8px; padding: 0 8px 0 14px; height: 32px; }
.tb-links__item a { color: var(--ink); text-decoration: none; flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; }
.tb-links__item a:hover { color: var(--accent); text-decoration: underline; }
.tb-links__host { font-family: var(--mono); font-size: 10.5px; color: var(--muted); white-space: nowrap; }
.tb-links__item button { border: 0; background: none; color: var(--muted); cursor: pointer; width: 22px; height: 22px; border-radius: 4px; font: inherit; }
.tb-links__item button:hover { background: var(--surface-2); color: var(--ink); }
.tb-links__empty { padding: 14px; color: var(--muted); font-size: 13px; }
.tb-links__add { display: grid; grid-template-columns: 1fr 1fr auto; gap: 6px; padding: 8px; border-top: 1px solid var(--border); }
.tb-links__add input { min-width: 0; height: 28px; border: 1px solid var(--border); border-radius: 4px; padding: 0 8px; background: var(--bg); color: var(--ink); font: inherit; font-size: 12px; }
.tb-links__add input:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
`;

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

function normalise(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  const candidate = /^[a-z]+:\/\//i.test(value) ? value : `https://${value}`;
  try {
    const url = new URL(candidate);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null;
  } catch {
    return null;
  }
}

export default definePlugin({
  manifest: {
    apiVersion: 1,
    id: 'spotcanvas.links',
    name: 'Links',
    kind: 'widget',
    version: '0.1.0',
    size: [300, 220],
    permissions: ['storage']
  },
  mount(host, api) {
    api.ui.style(CSS);
    const state = api.storage.get<State>() ?? { items: [] };
    const root = h('div', 'tb-links');
    const list = h('ul', 'tb-links__list');
    list.setAttribute('aria-label', 'Links');
    const form = h('form', 'tb-links__add');
    const label = h('input');
    label.placeholder = 'Label';
    label.maxLength = MAX_LABEL;
    label.setAttribute('aria-label', 'Link label');
    const url = h('input');
    url.placeholder = 'thoughtspot.com/…';
    url.setAttribute('aria-label', 'Link address');
    const add = h('button', 'tb-btn tb-btn--primary', 'Add');
    add.type = 'submit';
    form.append(label, url, add);

    const render = () => {
      list.replaceChildren();
      if (state.items.length === 0) {
        list.append(h('li', 'tb-links__empty', 'No links yet. Add the pages you open every day.'));
      }
      state.items.forEach((item, index) => {
        const li = h('li', 'tb-links__item');
        const a = h('a', undefined, item.label);
        a.href = item.url;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        const meta = h('span', 'tb-links__host', hostOf(item.url));
        const remove = h('button', undefined, '✕');
        remove.type = 'button';
        remove.setAttribute('aria-label', `Remove ${item.label}`);
        remove.onclick = () => {
          state.items.splice(index, 1);
          api.storage.set(state);
          render();
        };
        li.append(a, meta, remove);
        list.append(li);
      });
      add.disabled = state.items.length >= MAX_LINKS;
    };

    form.onsubmit = (e) => {
      e.preventDefault();
      const href = normalise(url.value);
      if (!href) {
        api.ui.notify('That link needs to be an http(s) address.', 'error');
        return;
      }
      const text = label.value.trim() || hostOf(href) || href;
      state.items.push({ label: text.slice(0, MAX_LABEL), url: href });
      api.storage.set(state);
      label.value = '';
      url.value = '';
      render();
      label.focus();
    };

    render();
    root.append(list, form);
    host.append(root);
  }
});
