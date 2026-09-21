import type { HostKind } from '@spot-canvas/sdk';

export function hostKind(): HostKind {
  return typeof window !== 'undefined' && window.spotCanvasHost?.kind === 'desktop' ? 'desktop' : 'web';
}
