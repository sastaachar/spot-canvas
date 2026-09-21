import type { ThemeName } from '@spot-canvas/sdk';

const DARK_QUERY = '(prefers-color-scheme: dark)';

export function currentTheme(root: HTMLElement = document.documentElement): ThemeName {
  const forced = root.getAttribute('data-theme');
  if (forced === 'dark' || forced === 'light') return forced;
  return typeof matchMedia === 'function' && matchMedia(DARK_QUERY).matches ? 'dark' : 'light';
}

export function onThemeChange(handler: (theme: ThemeName) => void): () => void {
  const root = document.documentElement;
  let last = currentTheme(root);
  const check = () => {
    const next = currentTheme(root);
    if (next === last) return;
    last = next;
    handler(next);
  };
  const media = typeof matchMedia === 'function' ? matchMedia(DARK_QUERY) : null;
  media?.addEventListener('change', check);
  const observer = new MutationObserver(check);
  observer.observe(root, { attributes: true, attributeFilter: ['data-theme'] });
  return () => {
    media?.removeEventListener('change', check);
    observer.disconnect();
  };
}
