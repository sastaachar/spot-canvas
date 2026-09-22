import { create } from 'zustand';
import { ApiError, sendChat, type ChatAction, type ChatCataloguePlugin, type ChatTurn } from './api';
import { ghostDuration, newRects, reducedMotion, useGhostStore } from './ghosts';
import { pxSizeToUnits } from './grid';
import { applyLayoutDocument, parseLayoutDocument } from './persistence';
import { usePluginRegistry } from './registry';
import { useToastStore } from './toasts';

const MAX_TURNS = 12;
const UNREACHABLE = 'Spotter is not reachable right now.';

export interface TranscriptTurn extends ChatTurn {
  actions?: ChatAction[];
}

interface ChatState {
  turns: TranscriptTurn[];
  pending: boolean;
  lastReply: string | null;
  error: string | null;
  send(message: string): Promise<void>;
  dismiss(): void;
}

export function catalogue(): ChatCataloguePlugin[] {
  const { plugins, suiteOf } = usePluginRegistry.getState();
  return Object.values(plugins).map((p) => ({
    id: p.manifest.id,
    name: p.manifest.name,
    kind: p.manifest.kind,
    size: [pxSizeToUnits(p.manifest.size).w, pxSizeToUnits(p.manifest.size).h] as [number, number],
    suiteId: suiteOf[p.manifest.id] ?? null
  }));
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// New panels and groups get an animated outline at their final size before they appear.
async function revealThenApply(layout: unknown): Promise<void> {
  const doc = parseLayoutDocument(typeof layout === 'string' ? layout : JSON.stringify(layout));
  if (!doc) {
    useToastStore.getState().push('Spotter changed the page but it could not be reloaded.', 'error', 'spotter');
    return;
  }
  const ghosts = reducedMotion() ? [] : newRects(doc);
  if (ghosts.length > 0) {
    useGhostStore.getState().show(ghosts);
    await sleep(ghostDuration(ghosts.length));
  }
  const applied = await applyLayoutDocument(doc);
  useGhostStore.getState().clear();
  if (!applied) useToastStore.getState().push('Spotter changed the page but it could not be reloaded.', 'error', 'spotter');
}

export const useChatStore = create<ChatState>()((set, get) => ({
  turns: [],
  pending: false,
  lastReply: null,
  error: null,

  async send(message) {
    const text = message.trim();
    if (!text || get().pending) return;
    const turns = [...get().turns, { role: 'user' as const, content: text }].slice(-MAX_TURNS);
    set({ turns, pending: true, error: null, lastReply: null });
    try {
      const history = turns.slice(0, -1).map(({ role, content }) => ({ role, content }));
      const result = await sendChat(text, history, catalogue());
      if (result.changed && result.layout !== undefined) {
        await revealThenApply(result.layout);
      }
      set({
        turns: [...turns, { role: 'assistant' as const, content: result.reply, actions: result.actions ?? [] }].slice(-MAX_TURNS),
        pending: false,
        lastReply: result.reply
      });
    } catch (error) {
      set({ pending: false, error: error instanceof ApiError ? error.message : UNREACHABLE });
    }
  },

  dismiss() {
    set({ lastReply: null, error: null });
  }
}));
