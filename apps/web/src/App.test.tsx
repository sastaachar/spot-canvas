import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { registerBuiltins } from './core/builtins';
import { getPlugin } from './core/registry';
import { useCanvasStore } from './core/store';
import { useToastStore } from './core/toasts';

beforeEach(() => {
  registerBuiltins();
  useCanvasStore.setState({ panels: {}, seq: 0, nextZ: 1, drawerOpen: false, drawerTab: 'browse' });
  useToastStore.setState({ toasts: [] });
});

afterEach(cleanup);

const shadowOf = (panel: HTMLElement) => panel.querySelector('.panel__body')!.shadowRoot!;

describe('App', () => {
  it('starts blank, adds a plugin from the drawer, mounts it in a shadow root, and removes it', () => {
    render(<App />);
    expect(screen.getByText('Blank canvas')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Add plugin' }));
    const drawer = screen.getByRole('complementary', { name: 'Plugins', hidden: true });
    expect(drawer.className).toContain('is-open');

    const row = within(drawer).getByText('Sticky note').closest('li')!;
    fireEvent.click(within(row).getByRole('button', { name: 'Add' }));

    const panel = screen.getByRole('region', { name: 'Sticky note' });
    const shadow = shadowOf(panel);
    expect(shadow.querySelector('style[data-spot-canvas-plugin="spotcanvas.note"]')).toBeTruthy();
    expect(document.head.querySelector('style[data-spot-canvas-plugin]')).toBeNull();

    const note = shadow.querySelector('textarea')!;
    fireEvent.input(note, { target: { value: 'hello' } });
    const [state] = Object.values(useCanvasStore.getState().panels);
    expect(state?.data).toEqual({ text: 'hello' });
    expect(within(row).getByRole('button', { name: 'Add another' })).toBeTruthy();

    fireEvent.click(within(panel).getByRole('button', { name: 'Close Sticky note' }));
    expect(screen.queryByRole('region', { name: 'Sticky note' })).toBeNull();
    expect(screen.getByText('Blank canvas')).toBeTruthy();
  });

  it('closes the drawer on Escape and opens Developer from the rail', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Developer' }));
    expect(screen.getByRole('tab', { name: 'Developer', hidden: true }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByLabelText('Load a plugin module', { selector: 'input' })).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(useCanvasStore.getState().drawerOpen).toBe(false);
  });

  it('reports a plugin url that cannot be loaded', async () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Developer' }));
    const input = screen.getByLabelText('Load a plugin module', { selector: 'input' });
    fireEvent.change(input, { target: { value: 'http://example.com/plugin.js' } });
    fireEvent.submit(input.closest('form')!);
    const status = await screen.findByText(/https/);
    expect(status.className).toContain('is-error');
  });

  it('moves a panel when its header is dragged', () => {
    render(<App />);
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

  it('shows a plugin title override and toasts, and dismisses them', () => {
    vi.useFakeTimers();
    render(<App />);
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
