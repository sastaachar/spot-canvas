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
  const api = { fetchMe: vi.fn(), signIn: vi.fn(), signOut: vi.fn() };
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

const user = { id: 'u1', name: 'alice', displayName: 'Alice' };
const notePanel: PanelState = {
  iid: 'spotcanvas.note#1',
  pluginId: 'spotcanvas.note',
  x: 10,
  y: 20,
  w: 240,
  h: 160,
  z: 1,
  data: { text: 'saved earlier' }
};

beforeEach(() => {
  usePluginRegistry.setState({ plugins: {}, suites: {}, suiteOf: {} });
  registerBuiltins();
  useSetupStore.setState({ suiteId: null, onDone: null });
  useCanvasStore.setState({ panels: {}, suites: {}, seq: 0, nextZ: 1, drawerOpen: false, drawerTab: 'browse' });
  useToastStore.setState({ toasts: [] });
  useMenuStore.setState({ open: false });
  useSession.setState({ status: 'loading', user: null, error: null });
  memory.value = null;
  api.fetchMe.mockReset().mockResolvedValue(user);
  api.signIn.mockReset().mockResolvedValue(user);
  api.signOut.mockReset().mockResolvedValue(undefined);
});

afterEach(cleanup);

const shadowOf = (panel: HTMLElement) => panel.querySelector('.panel__body')!.shadowRoot!;
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
}

describe('session', () => {
  it('asks for a token when there is no session, then loads the saved homepage', async () => {
    api.fetchMe.mockResolvedValue(null);
    memory.value = serializeLayout({ [notePanel.iid]: notePanel });
    render(<App />);

    const input = await screen.findByLabelText('ThoughtSpot token');
    fireEvent.change(input, { target: { value: 'dev-alice-token' } });
    fireEvent.submit(input.closest('form')!);

    const panel = await screen.findByRole('region', { name: 'Sticky note' });
    expect(api.signIn).toHaveBeenCalledWith('dev-alice-token');
    expect(shadowOf(panel).querySelector('textarea')!.value).toBe('saved earlier');
  });

  it('shows the API error when a token is refused', async () => {
    api.fetchMe.mockResolvedValue(null);
    api.signIn.mockRejectedValue(new Error('offline'));
    render(<App />);
    const input = await screen.findByLabelText('ThoughtSpot token');
    fireEvent.change(input, { target: { value: 'bad' } });
    fireEvent.submit(input.closest('form')!);
    expect((await screen.findByRole('alert')).textContent).toContain('not reachable');
    expect((input as HTMLInputElement).value).toBe('');
  });

  it('signs out from the canvas menu and clears the canvas', async () => {
    memory.value = serializeLayout({ [notePanel.iid]: notePanel });
    await renderSignedIn();
    expect(screen.getByRole('region', { name: 'Sticky note' })).toBeTruthy();

    fireEvent.contextMenu(canvas(), { clientX: 50, clientY: 50 });
    fireEvent.click(menuItem('Sign out Alice'));

    await screen.findByLabelText('ThoughtSpot token');
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
    const [state] = Object.values(useCanvasStore.getState().panels);
    expect(state).toMatchObject({ x: 300, y: 200 });
    expect(shadowOf(panel).querySelector('style[data-spot-canvas-plugin="spotcanvas.note"]')).toBeTruthy();

    await vi.waitFor(() => expect(parseLayout(memory.value)).toHaveLength(1));

    const head = within(panel).getByText('Sticky note').closest('header')!;
    fireEvent.contextMenu(head, { clientX: 310, clientY: 210 });
    fireEvent.click(menuItem('Remove Sticky note'));
    expect(screen.queryByRole('region', { name: 'Sticky note' })).toBeNull();
    expect(screen.getByText('Your homepage is empty')).toBeTruthy();
    await vi.waitFor(() => expect(parseLayout(memory.value)).toEqual([]));
  });

  it('leaves the native menu alone inside a plugin body and closes on Escape', async () => {
    await renderSignedIn();
    act(() => {
      useCanvasStore.getState().addPanel(getPlugin('spotcanvas.note')!.manifest);
    });
    const panel = screen.getByRole('region', { name: 'Sticky note' });
    const body = panel.querySelector('.panel__body')!;
    const ev = fireEvent.contextMenu(body, { clientX: 5, clientY: 5 });
    expect(ev).toBe(true);
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
    fireEvent.contextMenu(within(note).getByText('Sticky note').closest('header')!);
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
    const head = within(panel).getByText('Focus timer').closest('header')!;
    head.setPointerCapture = () => {};
    fireEvent.pointerDown(head, { button: 0, clientX: 100, clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(head, { clientX: 130, clientY: 150, pointerId: 1 });
    fireEvent.pointerUp(head, { pointerId: 1 });

    const moved = useCanvasStore.getState().panels[iid]!;
    expect(moved.x).toBe(100);
    expect(moved.y).toBe(90);
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
    expect(screen.getByRole('region', { name: 'Groceries' })).toBeTruthy();
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

    fireEvent.contextMenu(within(panel).getByText('Hello').closest('header')!);
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
