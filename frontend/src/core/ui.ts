import { create } from 'zustand';

interface UiState {
  profileOpen: boolean;
  renamingGid: string | null;
  setProfileOpen(open: boolean): void;
  setRenaming(gid: string | null): void;
}

export const useUiStore = create<UiState>()((set) => ({
  profileOpen: false,
  renamingGid: null,
  setProfileOpen(open) {
    set({ profileOpen: open });
  },
  setRenaming(gid) {
    set({ renamingGid: gid });
  }
}));
