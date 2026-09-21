import { create } from 'zustand';

export type MenuTarget = { kind: 'canvas' } | { kind: 'panel'; iid: string } | { kind: 'group'; gid: string };

interface MenuState {
  open: boolean;
  x: number;
  y: number;
  target: MenuTarget;
  openMenu(target: MenuTarget, x: number, y: number): void;
  closeMenu(): void;
}

export const useMenuStore = create<MenuState>()((set) => ({
  open: false,
  x: 0,
  y: 0,
  target: { kind: 'canvas' },
  openMenu(target, x, y) {
    set({ open: true, x, y, target });
  },
  closeMenu() {
    set({ open: false });
  }
}));
