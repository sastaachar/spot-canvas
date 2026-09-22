import { publishCatalogue, remoteLayoutBackend } from './api';
import { catalogue, useChatStore } from './chat';
import { useGhostStore } from './ghosts';
import { serializeLayout } from './persistence';
import { usePluginRegistry } from './registry';
import { revealThenApply } from './reveal';
import { useCanvasStore } from './store';

export const POLL_INTERVAL_MS = 5000;

/** Keep the server's copy of what this browser can add, and pick up edits made by agents elsewhere. */
export function startLayoutSync(): () => void {
  let stopped = false;
  let inFlight = false;

  const publish = () => {
    void publishCatalogue(catalogue()).catch(() => {
      // the chat route also accepts the catalogue inline, so a failed publish is not fatal
    });
  };
  publish();
  const unsubscribe = usePluginRegistry.subscribe(publish);

  const poll = async () => {
    if (stopped || inFlight) return;
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
    if (useChatStore.getState().pending || useGhostStore.getState().ghosts.length > 0) return;
    inFlight = true;
    try {
      const remote = await remoteLayoutBackend.read();
      if (stopped || remote === null) return;
      const { panels, suites, groups, preferences } = useCanvasStore.getState();
      if (remote === serializeLayout(panels, suites, groups, preferences)) return;
      await revealThenApply(remote, 'agent');
    } catch {
      // transient network trouble; the next tick retries
    } finally {
      inFlight = false;
    }
  };
  const timer = setInterval(() => void poll(), POLL_INTERVAL_MS);

  return () => {
    stopped = true;
    clearInterval(timer);
    unsubscribe();
  };
}
