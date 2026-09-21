import { afterEach, describe, expect, it, vi } from 'vitest';
import { currentTheme, onThemeChange } from './theme';

afterEach(() => {
  document.documentElement.removeAttribute('data-theme');
  vi.unstubAllGlobals();
});

describe('theme', () => {
  it('prefers the explicit data-theme stamp', () => {
    document.documentElement.setAttribute('data-theme', 'dark');
    expect(currentTheme()).toBe('dark');
    document.documentElement.setAttribute('data-theme', 'light');
    expect(currentTheme()).toBe('light');
  });

  it('falls back to the system preference', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
    expect(currentTheme()).toBe('dark');
  });

  it('notifies on a stamp change and stops after unsubscribe', async () => {
    const fn = vi.fn();
    const off = onThemeChange(fn);
    document.documentElement.setAttribute('data-theme', 'dark');
    await Promise.resolve();
    expect(fn).toHaveBeenCalledWith('dark');
    off();
    document.documentElement.setAttribute('data-theme', 'light');
    await Promise.resolve();
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
