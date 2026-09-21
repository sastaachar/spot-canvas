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

import { App } from './App';
import { registerBuiltins } from './core/builtins';
import { useMenuStore } from './core/menu';
import { parseLayout, serializeLayout } from './core/persistence';
import { getPlugin } from './core/registry';
import { useSession } from './core/session';
import { useCanvasStore, type PanelState } from './core/store';
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
  registerBuiltins();
  useCanvasStore.setState({ panels: {}, seq: 0, nextZ: 1, drawerOpen: false, drawerTab: 'browse' });
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
    fireEvent.click(menuItem('Add Sticky note'));
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
