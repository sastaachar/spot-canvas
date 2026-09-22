import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { api, memory } = vi.hoisted(() => {
  const memory = {
    value: null as string | null,
    async read() {
      return memory.value;
    },
    async write(json: string) {
      memory.value = json;
    }
  };
  const api = { fetchMe: vi.fn(), signIn: vi.fn(), signOut: vi.fn(), sendChat: vi.fn(), publishCatalogue: vi.fn(), createToken: vi.fn(), revokeTokens: vi.fn(), listTokens: vi.fn() };
  return { api, memory };
});

vi.mock('./core/api', () => ({
  ...api,
  remoteLayoutBackend: memory,
  ApiError: class ApiError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  }
}));

import { definePlugin, defineSuite, type SuiteSetupApi } from '@spot-canvas/sdk';
import { App } from './App';
import { registerBuiltins } from './core/builtins';
import { useMenuStore } from './core/menu';
import { parseLayout, parseLayoutDocument, serializeLayout } from './core/persistence';
import { getPlugin, usePluginRegistry } from './core/registry';
import { useSession } from './core/session';
import { useCanvasStore, type PanelState } from './core/store';
import { useSetupStore } from './core/suites';
import { useToastStore } from './core/toasts';
import { useChatStore } from './core/chat';
import { useGhostStore } from './core/ghosts';
import { useUiStore } from './core/ui';

const user = { id: 'u1', name: 'alice', displayName: 'Alice', cluster: 'my.thoughtspot.cloud' };
const notePanel: PanelState = {
  iid: 'spotcanvas.note#1',
  pluginId: 'spotcanvas.note',
  x: 1,
  y: 1,
  w: 4,
  h: 3,
  z: 1,
  data: { text: 'saved earlier' }
};

beforeEach(() => {
  usePluginRegistry.setState({ plugins: {}, suites: {}, suiteOf: {} });
  registerBuiltins();
  useSetupStore.setState({ suiteId: null, onDone: null });
  useCanvasStore.setState({
    panels: {},
    suites: {},
    groups: {},
    preferences: { theme: 'system' },
    seq: 0,
    gseq: 0,
    nextZ: 1,
    drawerOpen: false,
    drawerTab: 'browse'
  });
  useUiStore.setState({ profileOpen: false, renamingGid: null, selectedIid: null, renamingIid: null, movingIid: null });
  document.documentElement.removeAttribute('data-theme');
  localStorage.clear();
  useToastStore.setState({ toasts: [] });
  useMenuStore.setState({ open: false });
  useSession.setState({ status: 'loading', user: null, error: null });
  memory.value = null;
  api.fetchMe.mockReset().mockResolvedValue(user);
  api.signIn.mockReset().mockResolvedValue(user);
  api.signOut.mockReset().mockResolvedValue(undefined);
  api.sendChat.mockReset();
  api.publishCatalogue.mockReset().mockResolvedValue(undefined);
  api.createToken.mockReset();
  api.revokeTokens.mockReset().mockResolvedValue(1);
  useChatStore.setState({ turns: [], pending: false, lastReply: null, error: null });
  useGhostStore.setState({ ghosts: [] });
});

afterEach(cleanup);

const shadowOf = (panel: HTMLElement) => panel.querySelector('.panel__body')!.shadowRoot!;
const headerOf = (panel: HTMLElement) => panel.querySelector('header') ?? panel;
const moverOf = (panel: HTMLElement) => panel.querySelector<HTMLElement>('.panel__mover') ?? headerOf(panel);
const unlockMove = (panel: HTMLElement) => {
  fireEvent.contextMenu(headerOf(panel));
  fireEvent.click(screen.getByRole('menuitem', { name: /^Move/ }));
};
const canvas = () => screen.getByRole('main');
const menuItem = (name: string | RegExp) => screen.getByRole('menuitem', { name });
const openAddMenu = () => {
  fireEvent.click(menuItem('Add plugin'));
  return screen.getByRole('menu', { name: 'Add plugin' });
};
const addFromMenu = (name: string) => fireEvent.click(within(openAddMenu()).getByRole('menuitem', { name: new RegExp(`^${name}`) }));

async function renderSignedIn() {
  render(<App />);
  await screen.findByRole('main');
  // let the restore promise chain settle before tests mutate the store
  await act(async () => {});
}

describe('session', () => {
  it('asks for cluster, username and password when there is no session, then loads the saved homepage', async () => {
    api.fetchMe.mockResolvedValue(null);
    memory.value = serializeLayout({ [notePanel.iid]: notePanel });
    localStorage.setItem('spot-canvas.last-cluster', 'remembered.thoughtspot.cloud');
    localStorage.setItem('spot-canvas.last-username', 'remembered.user');
    render(<App />);

    const cluster = (await screen.findByLabelText('Cluster URL')) as HTMLInputElement;
    expect(cluster.value).toBe('remembered.thoughtspot.cloud');
    expect((screen.getByLabelText('Username') as HTMLInputElement).value).toBe('remembered.user');
    const submit = screen.getByRole('button', { name: 'Sign in' }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    fireEvent.change(cluster, { target: { value: ' my.thoughtspot.cloud ' } });
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'jdoe' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'pw' } });
    expect(submit.disabled).toBe(false);
    fireEvent.submit(cluster.closest('form')!);

    const panel = await screen.findByRole('region', { name: 'Sticky note' });
    expect(api.signIn).toHaveBeenCalledWith({ clusterUrl: 'my.thoughtspot.cloud', username: 'jdoe', password: 'pw' });
    expect(localStorage.getItem('spot-canvas.last-cluster')).toBe('my.thoughtspot.cloud');
    expect(localStorage.getItem('spot-canvas.last-username')).toBe('jdoe');
    expect(shadowOf(panel).querySelector('textarea')!.value).toBe('saved earlier');
  });

  it('shows the API error when the cluster refuses the credentials and clears the password', async () => {
    api.fetchMe.mockResolvedValue(null);
    api.signIn.mockRejectedValue(new Error('offline'));
    render(<App />);
    const cluster = await screen.findByLabelText('Cluster URL');
    fireEvent.change(cluster, { target: { value: 'my.thoughtspot.cloud' } });
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'jdoe' } });
    const password = screen.getByLabelText('Password') as HTMLInputElement;
    fireEvent.change(password, { target: { value: 'bad' } });
    fireEvent.submit(cluster.closest('form')!);
    expect((await screen.findByRole('alert')).textContent).toContain('not reachable');
    expect(password.value).toBe('');
    expect((screen.getByLabelText('Username') as HTMLInputElement).value).toBe('jdoe');
  });

  it('signs out from the profile sheet and clears the canvas', async () => {
    memory.value = serializeLayout({ [notePanel.iid]: notePanel });
    await renderSignedIn();
    expect(screen.getByRole('region', { name: 'Sticky note' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Profile' }));
    const sheet = screen.getByRole('dialog', { name: 'Profile' });
    expect(within(sheet).getByText('Alice')).toBeTruthy();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Sign out' }));

    await screen.findByLabelText('Cluster URL');
    expect(api.signOut).toHaveBeenCalled();
    expect(useCanvasStore.getState().panels).toEqual({});
    expect(memory.value).toContain('saved earlier');
  });
});

describe('canvas', () => {
  it('adds a plugin where the canvas was right-clicked, persists it, and removes it from the panel menu', async () => {
    await renderSignedIn();
    expect(screen.getByText('Your homepage is empty')).toBeTruthy();

    fireEvent.contextMenu(canvas(), { clientX: 300, clientY: 200 });
    expect(screen.getByRole('menu')).toBeTruthy();
    addFromMenu('Sticky note');
    expect(screen.queryByRole('menu')).toBeNull();

    const panel = screen.getByRole('region', { name: 'Sticky note' });
    expect(panel.querySelector('header')).toBeNull();
    const [state] = Object.values(useCanvasStore.getState().panels);
    expect(state).toMatchObject({ x: 5, y: 4 });
    expect(panel.style.left).toBe(`${(5 / 24) * 100}%`);
    expect(shadowOf(panel).querySelector('style[data-spot-canvas-plugin="spotcanvas.note"]')).toBeTruthy();

    await vi.waitFor(() => expect(parseLayout(memory.value)).toHaveLength(1));

    const head = headerOf(panel);
    fireEvent.contextMenu(head, { clientX: 310, clientY: 210 });
    fireEvent.click(menuItem('Remove Sticky note'));
    expect(screen.queryByRole('region', { name: 'Sticky note' })).toBeNull();
    expect(screen.getByText('Your homepage is empty')).toBeTruthy();
    await vi.waitFor(() => expect(parseLayout(memory.value)).toEqual([]));
  });

  it('opens the widget menu from anywhere on the widget and closes on Escape', async () => {
    await renderSignedIn();
    act(() => {
      useCanvasStore.getState().addPanel(getPlugin('spotcanvas.note')!.manifest);
    });
    const panel = screen.getByRole('region', { name: 'Sticky note' });
    const body = panel.querySelector('.panel__body')!;
    const ev = fireEvent.contextMenu(body, { clientX: 5, clientY: 5 });
    expect(ev).toBe(false);
    expect(useMenuStore.getState()).toMatchObject({ open: true, target: { kind: 'panel' } });
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(useMenuStore.getState().open).toBe(false);

    fireEvent.contextMenu(canvas(), { clientX: 5, clientY: 5 });
    expect(useMenuStore.getState().open).toBe(true);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(useMenuStore.getState().open).toBe(false);
  });

  it('brings a panel to the front and clears the homepage from the menus', async () => {
    await renderSignedIn();
    let a = '';
    act(() => {
      a = useCanvasStore.getState().addPanel(getPlugin('spotcanvas.note')!.manifest);
      useCanvasStore.getState().addPanel(getPlugin('spotcanvas.timer')!.manifest);
    });
    const note = screen.getByRole('region', { name: 'Sticky note' });
    fireEvent.contextMenu(headerOf(note));
    fireEvent.click(menuItem('Bring to front'));
    expect(useCanvasStore.getState().panels[a]!.z).toBe(3);

    fireEvent.contextMenu(canvas());
    fireEvent.click(menuItem('Clear homepage'));
    expect(useCanvasStore.getState().panels).toEqual({});

    fireEvent.contextMenu(canvas());
    expect((menuItem('Clear homepage') as HTMLButtonElement).disabled).toBe(true);
  });

  it('opens the developer drawer from the menu, reports bad urls, and closes on Escape', async () => {
    await renderSignedIn();
    fireEvent.contextMenu(canvas());
    fireEvent.click(menuItem('Load plugin from URL…'));
    expect(screen.getByRole('tab', { name: 'Developer', hidden: true }).getAttribute('aria-selected')).toBe('true');

    const input = screen.getByLabelText('Load a plugin module', { selector: 'input' });
    fireEvent.change(input, { target: { value: 'http://example.com/plugin.js' } });
    fireEvent.submit(input.closest('form')!);
    const status = await screen.findByText(/https/);
    expect(status.className).toContain('is-error');

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(useCanvasStore.getState().drawerOpen).toBe(false);
  });

  it('moves a panel when its header is dragged', async () => {
    await renderSignedIn();
    let iid = '';
    act(() => {
      iid = useCanvasStore.getState().addPanel(getPlugin('spotcanvas.timer')!.manifest);
    });

    const panel = screen.getByRole('region', { name: 'Focus timer' });
    const head = headerOf(panel);
    head.setPointerCapture = () => {};
    // locked by default: dragging does nothing
    fireEvent.pointerDown(head, { button: 0, clientX: 100, clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(head, { clientX: 130, clientY: 150, pointerId: 1 });
    fireEvent.pointerUp(head, { pointerId: 1 });
    expect(useCanvasStore.getState().panels[iid]).toMatchObject({ x: 1, y: 1 });
    expect(panel.querySelector('.panel__grip')).toBeNull();

    unlockMove(panel);
    expect(panel.className).toContain('is-moving');
    expect(panel.querySelector('.panel__grip')).toBeTruthy();
    const mover = moverOf(panel);
    mover.setPointerCapture = () => {};
    fireEvent.pointerDown(mover, { button: 0, clientX: 100, clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(mover, { clientX: 130, clientY: 150, pointerId: 1 });
    fireEvent.pointerUp(mover, { pointerId: 1 });

    const moved = useCanvasStore.getState().panels[iid]!;
    expect(moved.x).toBe(2);
    expect(moved.y).toBe(2);
    // locked again after the drop
    expect(panel.className).not.toContain('is-moving');
    fireEvent.pointerDown(head, { button: 0, clientX: 100, clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(head, { clientX: 400, clientY: 400, pointerId: 1 });
    fireEvent.pointerUp(head, { pointerId: 1 });
    expect(useCanvasStore.getState().panels[iid]).toMatchObject({ x: 2, y: 2 });

    unlockMove(panel);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(panel.className).not.toContain('is-moving');
  });

  it('shows a plugin title override and toasts, and dismisses them', async () => {
    await renderSignedIn();
    vi.useFakeTimers();
    let iid = '';
    act(() => {
      iid = useCanvasStore.getState().addPanel(getPlugin('spotcanvas.note')!.manifest);
      useCanvasStore.getState().setPanelTitle(iid, 'Groceries');
      useToastStore.getState().push('Saved', 'success', iid);
    });
    const titled = screen.getByRole('region', { name: 'Groceries' });
    expect(titled.querySelector('header')!.textContent).toBe('Groceries');
    const toast = screen.getByText('Saved').closest('.toast') as HTMLElement;
    expect(toast.className).toContain('toast--success');
    expect(within(toast).getByText('spotcanvas.note')).toBeTruthy();

    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(screen.queryByText('Saved')).toBeNull();
    vi.useRealTimers();
  });
});

const hello = definePlugin({
  manifest: { apiVersion: 1, id: 'acme.hello', name: 'Hello', kind: 'widget', version: '0.1.0', size: [240, 160] },
  mount(host, api) {
    const p = document.createElement('p');
    p.className = 'hello-host';
    p.textContent = `host=${String(api.settings.get()['host'] ?? 'unset')}`;
    host.append(p);
  }
});

const formSuite = () =>
  defineSuite({
    manifest: {
      apiVersion: 1,
      id: 'acme.suite',
      name: 'Acme',
      version: '0.1.0',
      description: 'Needs a server',
      settings: [
        { key: 'host', label: 'Server URL', type: 'url', required: true, help: 'Where Acme runs' },
        { key: 'retries', label: 'Retries', type: 'number' },
        { key: 'dark', label: 'Dark charts', type: 'boolean' },
        { key: 'region', label: 'Region', type: 'select', options: [{ value: 'eu', label: 'Europe' }] }
      ]
    },
    plugins: [hello]
  });

describe('suites', () => {
  it('groups suite plugins in the add menu and asks for required settings before adding', async () => {
    usePluginRegistry.getState().registerSuite(formSuite());
    await renderSignedIn();

    fireEvent.contextMenu(canvas(), { clientX: 40, clientY: 40 });
    const add = openAddMenu();
    expect(within(add).getByText('Acme')).toBeTruthy();
    fireEvent.click(within(add).getByRole('menuitem', { name: /^Hello/ }));

    const dialog = await screen.findByRole('dialog', { name: 'Set up Acme' });
    expect(screen.queryByRole('region', { name: 'Hello' })).toBeNull();

    fireEvent.submit(within(dialog).getByRole('button', { name: 'Save' }).closest('form')!);
    expect(useToastStore.getState().toasts.at(-1)?.message).toContain('Server URL');
    expect(screen.getByRole('dialog', { name: 'Set up Acme' })).toBeTruthy();

    fireEvent.change(within(dialog).getByLabelText(/Server URL/), { target: { value: 'https://acme.example' } });
    fireEvent.change(within(dialog).getByLabelText('Retries'), { target: { value: '3' } });
    fireEvent.click(within(dialog).getByLabelText('Dark charts'));
    fireEvent.change(within(dialog).getByLabelText('Region'), { target: { value: 'eu' } });
    fireEvent.submit(within(dialog).getByRole('button', { name: 'Save' }).closest('form')!);

    expect(screen.queryByRole('dialog')).toBeNull();
    const panel = await screen.findByRole('region', { name: 'Hello' });
    expect(shadowOf(panel).querySelector('.hello-host')!.textContent).toBe('host=https://acme.example');
    expect(useCanvasStore.getState().suites['acme.suite']).toEqual({
      url: null,
      settings: { host: 'https://acme.example', retries: 3, dark: true, region: 'eu' },
      configured: true
    });
    await vi.waitFor(() => expect(parseLayoutDocument(memory.value)?.suites['acme.suite']?.configured).toBe(true));

    fireEvent.contextMenu(canvas());
    fireEvent.click(menuItem('Suites'));
    expect(screen.getByRole('menuitem', { name: /Acme settings…/ }).textContent).toContain('configured');
  });

  it('adds straight away once configured and reopens settings from a panel', async () => {
    usePluginRegistry.getState().registerSuite(formSuite());
    useCanvasStore.getState().configureSuite('acme.suite', { host: 'https://acme.example' });
    await renderSignedIn();

    fireEvent.contextMenu(canvas());
    addFromMenu('Hello');
    const panel = screen.getByRole('region', { name: 'Hello' });
    expect(screen.queryByRole('dialog')).toBeNull();

    fireEvent.contextMenu(headerOf(panel));
    fireEvent.click(menuItem(/Acme settings…/));
    const dialog = screen.getByRole('dialog', { name: 'Set up Acme' });
    expect((within(dialog).getByLabelText(/Server URL/) as HTMLInputElement).value).toBe('https://acme.example');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('lets a suite own its setup step, e.g. a login, and honours cancel and complete', async () => {
    let captured: SuiteSetupApi | null = null;
    const suite = defineSuite({
      manifest: {
        apiVersion: 1,
        id: 'ts.suite',
        name: 'ThoughtSpot',
        version: '0.1.0',
        settings: [{ key: 'host', label: 'Cluster', type: 'url', required: true }]
      },
      plugins: [hello],
      setup(host, api) {
        captured = api;
        const b = document.createElement('button');
        b.textContent = 'Log in';
        host.append(b);
      }
    });
    usePluginRegistry.getState().registerSuite(suite);
    await renderSignedIn();

    fireEvent.contextMenu(canvas());
    addFromMenu('Hello');
    const dialog = await screen.findByRole('dialog', { name: 'Set up ThoughtSpot' });
    expect(dialog.querySelector('.setup__custom')!.shadowRoot!.textContent).toContain('Log in');

    act(() => captured!.cancel());
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByRole('region', { name: 'Hello' })).toBeNull();

    fireEvent.contextMenu(canvas());
    addFromMenu('Hello');
    await screen.findByRole('dialog', { name: 'Set up ThoughtSpot' });
    act(() => captured!.complete({}));
    expect(useToastStore.getState().toasts.at(-1)?.message).toContain('Cluster');
    act(() => captured!.complete({ host: 'https://ts.example', token: 'abc' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(await screen.findByRole('region', { name: 'Hello' })).toBeTruthy();
    expect(useCanvasStore.getState().suites['ts.suite']).toMatchObject({ configured: true, settings: { host: 'https://ts.example', token: 'abc' } });
  });

  it('shows an empty flyout message when nothing can be added', async () => {
    usePluginRegistry.setState({ plugins: {}, suites: {}, suiteOf: {} });
    await renderSignedIn();
    fireEvent.contextMenu(canvas());
    const add = openAddMenu();
    expect(within(add).getByText('Nothing available')).toBeTruthy();
  });
});

describe('groups', () => {
  const dragHeader = (head: HTMLElement, from: [number, number], to: [number, number]) => {
    head.setPointerCapture = () => {};
    fireEvent.pointerDown(head, { button: 0, clientX: from[0], clientY: from[1], pointerId: 1 });
    fireEvent.pointerMove(head, { clientX: to[0], clientY: to[1], pointerId: 1 });
    fireEvent.pointerUp(head, { pointerId: 1 });
  };

  it('creates a group from the menu, renames it inline, and adopts a panel dropped inside', async () => {
    await renderSignedIn();
    fireEvent.contextMenu(canvas(), { clientX: 100, clientY: 100 });
    fireEvent.click(menuItem('New group here'));

    const rename = screen.getByRole('textbox', { name: 'Group name' });
    fireEvent.change(rename, { target: { value: 'Sales' } });
    fireEvent.keyDown(rename, { key: 'Enter' });
    const group = screen.getByRole('region', { name: 'Group Sales' });
    expect(useCanvasStore.getState().groups['group#1']).toMatchObject({ x: 2, y: 2, w: 10, h: 7, title: 'Sales', color: 'blue' });
    expect(within(group).getByText('0 panels')).toBeTruthy();

    act(() => {
      useCanvasStore.getState().addPanel(getPlugin('spotcanvas.note')!.manifest, { x: 20, y: 13 });
    });
    const panel = screen.getByRole('region', { name: 'Sticky note' });
    expect(panel.querySelector('header')).toBeNull();
    unlockMove(panel);
    dragHeader(moverOf(panel), [700, 700], [40, 60]);
    // dropped inside: the group lays it out in its flow, first slot under the title row
    const [state] = Object.values(useCanvasStore.getState().panels);
    expect(state).toMatchObject({ x: 2, y: 3, groupId: 'group#1' });
    expect(within(group).getByText('1 panel')).toBeTruthy();

    unlockMove(panel);
    dragHeader(moverOf(panel), [40, 60], [900, 900]);
    expect(Object.values(useCanvasStore.getState().panels)[0]!.groupId).toBeNull();
    await vi.waitFor(() => expect(parseLayoutDocument(memory.value)?.groups).toHaveLength(1));
  });

  it('moves member panels with the group and offers colour, ungroup and remove from the group menu', async () => {
    await renderSignedIn();
    let iid = '';
    act(() => {
      const store = useCanvasStore.getState();
      const gid = store.addGroup({ x: 1, y: 1, w: 10, h: 7 }, 'Ops');
      iid = store.addPanel(getPlugin('spotcanvas.timer')!.manifest, { x: 2, y: 3 });
      store.assignPanel(iid, gid);
    });
    const group = screen.getByRole('region', { name: 'Group Ops' });
    expect(useCanvasStore.getState().panels[iid]).toMatchObject({ x: 1, y: 2 });
    dragHeader(headerOf(group), [60, 60], [110, 90]);
    expect(useCanvasStore.getState().groups['group#1']).toMatchObject({ x: 2, y: 2 });
    expect(useCanvasStore.getState().panels[iid]).toMatchObject({ x: 2, y: 3 });

    fireEvent.contextMenu(headerOf(group));
    fireEvent.click(menuItem('Colour'));
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Violet' }));
    expect(useCanvasStore.getState().groups['group#1']!.color).toBe('violet');

    fireEvent.contextMenu(headerOf(group));
    fireEvent.click(menuItem(/^Ungroup/));
    expect(useCanvasStore.getState().groups).toEqual({});
    expect(useCanvasStore.getState().panels[iid]!.groupId).toBeNull();

    act(() => {
      const store = useCanvasStore.getState();
      store.assignPanel(iid, store.addGroup({ x: 0, y: 0 }, 'Temp'));
    });
    const temp = screen.getByRole('region', { name: 'Group Temp' });
    fireEvent.contextMenu(headerOf(temp));
    fireEvent.click(menuItem(/Remove group and its panel/));
    expect(useCanvasStore.getState().panels).toEqual({});
    expect(screen.getByText('Your homepage is empty')).toBeTruthy();
  });

  it('assigns a panel to a group from its menu', async () => {
    await renderSignedIn();
    act(() => {
      const store = useCanvasStore.getState();
      store.addGroup({ x: 0, y: 0 }, 'Finance');
      store.addPanel(getPlugin('spotcanvas.note')!.manifest, { x: 900, y: 900 });
    });
    const panel = screen.getByRole('region', { name: 'Sticky note' });
    fireEvent.contextMenu(headerOf(panel));
    fireEvent.click(menuItem('Group'));
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Finance' }));
    expect(Object.values(useCanvasStore.getState().panels)[0]!.groupId).toBe('group#1');
  });
});

describe('selection and edit', () => {
  it('selects a widget on click, clears on canvas click, and renames it through Edit', async () => {
    await renderSignedIn();
    act(() => {
      useCanvasStore.getState().addPanel(getPlugin('spotcanvas.note')!.manifest);
    });
    const panel = screen.getByRole('region', { name: 'Sticky note' });
    expect(panel.className).not.toContain('is-selected');
    expect(within(panel).queryByRole('button')).toBeNull();

    fireEvent.pointerDown(panel);
    expect(panel.className).toContain('is-selected');
    expect(panel.getAttribute('aria-selected')).toBe('true');
    fireEvent.pointerDown(canvas());
    expect(panel.className).not.toContain('is-selected');

    fireEvent.contextMenu(headerOf(panel));
    expect(panel.className).toContain('is-selected');
    const items = screen.getAllByRole('menuitem').map((m) => m.textContent);
    expect(items[0]).toContain('Edit');
    fireEvent.click(menuItem(/^Edit/));

    const input = screen.getByRole('textbox', { name: 'Widget name' }) as HTMLInputElement;
    expect(input.value).toBe('Sticky note');
    fireEvent.change(input, { target: { value: 'Groceries' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByRole('region', { name: 'Groceries' })).toBeTruthy();
    expect(headerOf(screen.getByRole('region', { name: 'Groceries' })).textContent).toBe('Groceries');

    fireEvent.doubleClick(headerOf(screen.getByRole('region', { name: 'Groceries' })));
    const again = screen.getByRole('textbox', { name: 'Widget name' });
    fireEvent.change(again, { target: { value: '   ' } });
    fireEvent.keyDown(again, { key: 'Escape' });
    expect(screen.getByRole('region', { name: 'Groceries' })).toBeTruthy();
  });
});

describe('agents over MCP', () => {
  it('publishes the plugin catalogue after sign-in', async () => {
    await renderSignedIn();
    await vi.waitFor(() => expect(api.publishCatalogue).toHaveBeenCalled());
    const [catalogue] = api.publishCatalogue.mock.calls[0] as [Array<{ id: string; size: [number, number] }>];
    expect(catalogue.map((c) => c.id)).toContain('spotcanvas.link');
    expect(catalogue.find((c) => c.id === 'spotcanvas.note')?.size).toEqual([4, 3]);
  });

  it('creates an MCP token from the profile sheet and shows the client config once', async () => {
    await renderSignedIn();
    api.createToken.mockResolvedValue({ token: 'sc_secret123', tokens: [{ label: 'MCP', createdAt: 1 }] });
    fireEvent.click(screen.getByRole('button', { name: 'Profile' }));
    const sheet = screen.getByRole('dialog', { name: 'Profile' });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Create MCP token' }));
    const config = await within(sheet).findByLabelText('MCP configuration');
    expect(config.textContent).toContain('sc_secret123');
    expect(config.textContent).toContain('SPOT_CANVAS_URL');
    fireEvent.click(within(sheet).getByRole('button', { name: 'Revoke all' }));
    await vi.waitFor(() => expect(within(sheet).queryByLabelText('MCP configuration')).toBeNull());
    expect(api.revokeTokens).toHaveBeenCalled();
  });

  it('picks up a layout changed elsewhere and reveals the new widgets', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await renderSignedIn();
    expect(screen.queryByRole('region', { name: 'Sticky note' })).toBeNull();
    memory.value = serializeLayout({ [notePanel.iid]: notePanel });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5100);
    });
    expect(await screen.findAllByTestId('ghost')).toHaveLength(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });
    expect(screen.getByRole('region', { name: 'Sticky note' })).toBeTruthy();
    vi.useRealTimers();
  });
});

describe('profile, theme and chat', () => {
  it('switches theme from the profile sheet and persists the preference', async () => {
    await renderSignedIn();
    fireEvent.click(screen.getByRole('button', { name: 'Profile' }));
    const sheet = screen.getByRole('dialog', { name: 'Profile' });
    fireEvent.click(within(sheet).getByRole('radio', { name: 'Dark' }));
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    fireEvent.click(within(sheet).getByRole('radio', { name: 'System' }));
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
    fireEvent.click(within(sheet).getByRole('radio', { name: 'Light' }));
    await vi.waitFor(() => expect(parseLayoutDocument(memory.value)?.preferences.theme).toBe('light'));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Profile' })).toBeNull();
  });

  it('lists suites and plugins in the profile sheet and opens suite setup from it', async () => {
    usePluginRegistry.getState().registerSuite(formSuite());
    await renderSignedIn();
    act(() => {
      useCanvasStore.getState().addPanel(getPlugin('spotcanvas.link')!.manifest);
    });
    fireEvent.contextMenu(canvas());
    fireEvent.click(menuItem('Profile & appearance…'));
    const sheet = screen.getByRole('dialog', { name: 'Profile' });
    expect(within(sheet).getByText('Acme')).toBeTruthy();
    expect(within(sheet).getByText('1 on page')).toBeTruthy();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Set up' }));
    expect(screen.getByRole('dialog', { name: 'Set up Acme' })).toBeTruthy();
  });

  it('sends chat with the plugin catalogue, applies the returned layout, and shows the reply', async () => {
    await renderSignedIn();
    api.sendChat.mockResolvedValue({
      reply: 'Added a note in a Today group.',
      changed: true,
      actions: [
        { tool: 'create_group', summary: 'Created group Today', changed: true },
        { tool: 'add_panel', summary: 'Added Sticky note in Today', changed: true }
      ],
      layout: {
        version: 2,
        panels: [{ ...notePanel, groupId: 'group#1', data: { text: 'Standup 9:30' } }],
        groups: [{ gid: 'group#1', title: 'Today', x: 0, y: 0, w: 8, h: 5, color: 'amber' }],
        suites: {},
        preferences: { theme: 'system' }
      }
    });
    const input = screen.getByRole('textbox', { name: 'Message Spotter' });
    expect((screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(input, { target: { value: 'Add a note for standup' } });
    fireEvent.submit(input.closest('form')!);

    // outlines are drawn at the final rectangles before anything appears
    const ghosts = await screen.findAllByTestId('ghost');
    expect(ghosts).toHaveLength(2);
    expect(ghosts[0]!.getAttribute('class')).toContain('ghost--group');
    expect(ghosts[0]!.style.width).toBe(`${(8 / 24) * 100}%`);
    expect(ghosts[1]!.style.width).toBe(`${(4 / 24) * 100}%`);
    expect(screen.queryByRole('region', { name: 'Sticky note' })).toBeNull();

    expect((await screen.findByRole('status', {}, { timeout: 3000 })).textContent).toContain('Added a note in a Today group.');
    expect(screen.queryByTestId('ghost')).toBeNull();
    expect(screen.getByRole('region', { name: 'Group Today' })).toBeTruthy();
    const panel = screen.getByRole('region', { name: 'Sticky note' });
    expect(shadowOf(panel).querySelector('textarea')!.value).toBe('Standup 9:30');
    const [message, history, catalogue] = api.sendChat.mock.calls[0] as [string, unknown[], Array<{ id: string }>];
    expect(message).toBe('Add a note for standup');
    expect(history).toEqual([]);
    expect(catalogue.map((c) => c.id)).toContain('spotcanvas.note');
    expect((input as HTMLInputElement).value).toBe('');
    expect(useChatStore.getState().turns).toHaveLength(2);
    expect(useChatStore.getState().turns[1]?.actions).toHaveLength(2);

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss reply' }));
    expect(screen.queryByRole('status')).toBeNull();

    fireEvent.focus(input);
    const tools = screen.getByRole('list', { name: 'Tool calls' });
    expect(within(tools).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['✎Created group Today', '✎Added Sticky note in Today']);
  });

  it('offers to build the homepage from ThoughtSpot activity when the user came from a cluster', async () => {
    await renderSignedIn();
    api.sendChat.mockResolvedValue({ reply: 'Built from your activity.', changed: false, actions: [] });
    fireEvent.click(screen.getByRole('button', { name: 'Build from my ThoughtSpot activity' }));
    expect((await screen.findByRole('status')).textContent).toContain('Built from your activity.');
    expect((api.sendChat.mock.calls[0] as [string])[0]).toMatch(/last 3 months/);
  });

  it('hides the activity offer for users without a cluster', async () => {
    api.fetchMe.mockResolvedValue({ ...user, cluster: null });
    await renderSignedIn();
    expect(screen.queryByRole('button', { name: /ThoughtSpot activity/ })).toBeNull();
  });

  it('expands into a conversation panel when the bar is focused and collapses on outside click or Escape', async () => {
    await renderSignedIn();
    useChatStore.setState({
      turns: [
        { role: 'user', content: 'earlier question' },
        { role: 'assistant', content: 'earlier answer', actions: [{ tool: 'get_homepage', summary: 'Read the homepage', changed: false }] }
      ]
    });
    const input = screen.getByRole('textbox', { name: 'Message Spotter' });
    const shell = input.closest('.chat')!;
    const log = () => screen.getByTestId('chat-log');
    expect(shell.className).not.toContain('is-expanded');
    expect(log().getAttribute('aria-hidden')).toBe('true');
    expect(within(log()).queryByText('earlier question')).toBeNull();

    fireEvent.focus(input);
    expect(shell.className).toContain('is-expanded');
    expect(log().getAttribute('aria-hidden')).toBe('false');
    expect(within(log()).getByText('earlier question').className).toContain('chat__msg--user');
    expect(within(log()).getByText('earlier answer').className).toContain('chat__msg--assistant');
    expect(within(log()).getByText('Read the homepage').className).not.toContain('is-change');
    expect(input.getAttribute('aria-expanded')).toBe('true');

    fireEvent.pointerDown(canvas());
    expect(shell.className).not.toContain('is-expanded');

    fireEvent.pointerDown(input);
    expect(shell.className).toContain('is-expanded');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(shell.className).not.toContain('is-expanded');

    fireEvent.focus(input);
    fireEvent.click(screen.getByRole('button', { name: 'Collapse' }));
    expect(shell.className).not.toContain('is-expanded');
  });

  it('shows replies in the transcript while expanded instead of the floating bubble', async () => {
    await renderSignedIn();
    api.sendChat.mockResolvedValue({ reply: 'Here you go.', changed: false, actions: [] });
    const input = screen.getByRole('textbox', { name: 'Message Spotter' });
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'do something' } });
    fireEvent.submit(input.closest('form')!);
    const panel = screen.getByRole('log', { name: 'Spotter conversation' });
    expect(within(panel).getByRole('status').textContent).toContain('working');
    expect(await within(panel).findByText('Here you go.')).toBeTruthy();
    expect(within(panel).getByText('do something')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Dismiss reply' })).toBeNull();
  });

  it('shows chat errors in the bubble and keeps the page as it was', async () => {
    await renderSignedIn();
    api.sendChat.mockRejectedValue(new TypeError('Failed to fetch'));
    const input = screen.getByRole('textbox', { name: 'Message Spotter' });
    fireEvent.change(input, { target: { value: 'hello' } });
    fireEvent.submit(input.closest('form')!);
    const status = await screen.findByRole('status');
    expect(status.className).toContain('is-error');
    expect(status.textContent).toContain('not reachable');
    expect(useCanvasStore.getState().panels).toEqual({});
  });

  it('a Link widget holds one link with name, address and optional description', async () => {
    await renderSignedIn();
    fireEvent.contextMenu(canvas());
    addFromMenu('Link');
    const panel = screen.getByRole('region', { name: 'Link' });
    const shadow = shadowOf(panel);
    expect(shadow.querySelector('form')).toBeTruthy();
    fireEvent.input(shadow.querySelector('input[aria-label="Link name"]')!, { target: { value: 'Docs' } });
    fireEvent.input(shadow.querySelector('input[aria-label="Link address"]')!, { target: { value: 'docs.thoughtspot.com' } });
    fireEvent.input(shadow.querySelector('input[aria-label="Link description"]')!, { target: { value: 'Product documentation' } });
    fireEvent.submit(shadow.querySelector('form')!);

    const anchor = shadow.querySelector('a')!;
    expect(anchor.textContent).toContain('Docs');
    expect(anchor.href).toBe('https://docs.thoughtspot.com/');
    expect(anchor.rel).toContain('noopener');
    expect(shadow.querySelector('.tb-link__host')!.textContent).toBe('docs.thoughtspot.com');
    expect(shadow.querySelector('.tb-link__desc')!.textContent).toBe('Product documentation');
    const [state] = Object.values(useCanvasStore.getState().panels);
    expect(state!.data).toEqual({ name: 'Docs', url: 'https://docs.thoughtspot.com/', description: 'Product documentation' });

    fireEvent.contextMenu(headerOf(panel));
    expect(screen.getAllByRole('menuitem').map((m) => m.textContent?.trim())).toEqual(expect.arrayContaining([expect.stringContaining('Edit link…'), expect.stringContaining('Open link')]));
    fireEvent.click(menuItem(/Edit link…/));
    expect(shadow.querySelector('form')).toBeTruthy();
    fireEvent.click(shadow.querySelector('button[type="button"]')!);
    expect(shadow.querySelector('a')).toBeTruthy();
  });
});
