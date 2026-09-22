import { definePlugin, h } from '@spot-canvas/sdk';

interface State {
  name: string;
  url: string;
  description?: string;
}

const MAX_NAME = 60;
const MAX_DESCRIPTION = 160;

const CSS = `
.tb-link { height: 100%; display: flex; flex-direction: column; justify-content: center; padding: 10px 14px; gap: 2px; }
.tb-link__name { display: flex; align-items: baseline; gap: 8px; color: var(--ink); text-decoration: none; font-family: var(--display, inherit); font-weight: 500; font-size: 14px; min-width: 0; }
.tb-link__name span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tb-link__name:hover span { color: var(--accent); text-decoration: underline; }
.tb-link__arrow { color: var(--muted); font-size: 12px; flex: none; }
.tb-link__host { font-family: var(--mono); font-size: 10.5px; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.tb-link__desc { margin: 4px 0 0; color: var(--muted); font-size: 12px; line-height: 1.4; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
.tb-link__form { height: 100%; display: grid; gap: 6px; padding: 10px 12px; align-content: start; }
.tb-link__form input { min-width: 0; height: 28px; border: 1px solid var(--border); border-radius: 4px; padding: 0 8px; background: var(--bg); color: var(--ink); font: inherit; font-size: 12px; }
.tb-link__form input:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
.tb-link__actions { display: flex; justify-content: flex-end; gap: 6px; }
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
    id: 'spotcanvas.link',
    name: 'Link',
    kind: 'widget',
    version: '0.2.0',
    size: [200, 120],
    permissions: ['storage']
  },
  mount(host, api) {
    api.ui.style(CSS);
    const state: State = { name: '', url: '', ...(api.storage.get<Partial<State>>() ?? {}) };
    const root = h('div');
    root.style.height = '100%';
    host.append(root);
    let editing = !state.url;

    const renderCard = () => {
      const card = h('div', 'tb-link');
      const a = h('a', 'tb-link__name');
      a.href = state.url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.append(h('span', undefined, state.name || hostOf(state.url) || state.url), h('span', 'tb-link__arrow', '↗'));
      card.append(a, h('div', 'tb-link__host', hostOf(state.url)));
      if (state.description) card.append(h('p', 'tb-link__desc', state.description));
      return card;
    };

    const renderForm = () => {
      const form = h('form', 'tb-link__form');
      const name = h('input');
      name.placeholder = 'Name';
      name.maxLength = MAX_NAME;
      name.value = state.name;
      name.setAttribute('aria-label', 'Link name');
      const url = h('input');
      url.placeholder = 'Link, e.g. docs.thoughtspot.com';
      url.value = state.url;
      url.required = true;
      url.setAttribute('aria-label', 'Link address');
      const desc = h('input');
      desc.placeholder = 'Description (optional)';
      desc.maxLength = MAX_DESCRIPTION;
      desc.value = state.description ?? '';
      desc.setAttribute('aria-label', 'Link description');
      const actions = h('div', 'tb-link__actions');
      const save = h('button', 'tb-btn tb-btn--primary', 'Save');
      save.type = 'submit';
      actions.append(save);
      if (state.url) {
        const cancel = h('button', 'tb-btn', 'Cancel');
        cancel.type = 'button';
        cancel.onclick = () => {
          editing = false;
          render();
        };
        actions.prepend(cancel);
      }
      form.append(name, url, desc, actions);
      form.onsubmit = (e) => {
        e.preventDefault();
        const href = normalise(url.value);
        if (!href) {
          api.ui.notify('That link needs to be an http(s) address.', 'error');
          return;
        }
        state.url = href;
        state.name = name.value.trim().slice(0, MAX_NAME) || hostOf(href);
        const d = desc.value.trim().slice(0, MAX_DESCRIPTION);
        if (d) state.description = d;
        else delete state.description;
        api.storage.set(state);
        editing = false;
        render();
      };
      return form;
    };

    const render = () => {
      root.replaceChildren(editing ? renderForm() : renderCard());
      api.ui.setCommands(
        editing
          ? []
          : [
              { id: 'open', label: 'Open link', icon: '↗', onSelect: () => window.open(state.url, '_blank', 'noopener,noreferrer') },
              {
                id: 'edit',
                label: 'Edit link…',
                icon: '✎',
                onSelect: () => {
                  editing = true;
                  render();
                }
              }
            ]
      );
      if (editing) root.querySelector<HTMLInputElement>('input')?.focus();
    };

    render();
  }
});
