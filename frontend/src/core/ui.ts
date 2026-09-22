import { create } from 'zustand';

interface UiState {
  profileOpen: boolean;
  editMode: boolean;
  renamingGid: string | null;
  selectedIid: string | null;
  renamingIid: string | null;
  movingIid: string | null;
  setProfileOpen(open: boolean): void;
  setEditMode(on: boolean): void;
  toggleEditMode(): void;
  setRenaming(gid: string | null): void;
  select(iid: string | null): void;
  setRenamingPanel(iid: string | null): void;
  setMoving(iid: string | null): void;
}

export const useUiStore = create<UiState>()((set) => ({
  profileOpen: false,
  editMode: false,
  renamingGid: null,
  selectedIid: null,
  renamingIid: null,
  movingIid: null,
  setProfileOpen(open) {
    set({ profileOpen: open });
  },
  setEditMode(on) {
    set({ editMode: on });
  },
  toggleEditMode() {
    set((state) => ({ editMode: !state.editMode }));
  },
  setRenaming(gid) {
    set({ renamingGid: gid });
  },
  select(iid) {
    set({ selectedIid: iid });
  },
  setRenamingPanel(iid) {
    set((state) => ({ renamingIid: iid, selectedIid: iid ?? state.selectedIid }));
  },
  setMoving(iid) {
    set((state) => ({ movingIid: iid, selectedIid: iid ?? state.selectedIid }));
  }
}));
