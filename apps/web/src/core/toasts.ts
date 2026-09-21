import type { NotifyKind } from '@spot-canvas/sdk';
import { create } from 'zustand';

export interface Toast {
  id: number;
  message: string;
  kind: NotifyKind;
  from: string;
}

interface ToastState {
  toasts: Toast[];
  push(message: string, kind: NotifyKind, from: string): number;
  dismiss(id: number): void;
}

export const TOAST_TTL_MS = 4000;
const MAX_TOASTS = 4;
const MAX_MESSAGE = 200;

let nextId = 1;

export const useToastStore = create<ToastState>()((set, get) => ({
  toasts: [],
  push(message, kind, from) {
    const id = nextId++;
    const toast: Toast = { id, message: message.slice(0, MAX_MESSAGE), kind, from };
    set({ toasts: [...get().toasts, toast].slice(-MAX_TOASTS) });
    return id;
  },
  dismiss(id) {
    set({ toasts: get().toasts.filter((t) => t.id !== id) });
  }
}));
