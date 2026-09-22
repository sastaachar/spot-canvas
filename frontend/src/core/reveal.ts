import { ghostDuration, newRects, reducedMotion, useGhostStore } from './ghosts';
import { applyLayoutDocument, parseLayoutDocument } from './persistence';
import { useToastStore } from './toasts';

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Apply a layout that arrived from elsewhere (agent, MCP client), drawing outlines for new panels and groups first. */
export async function revealThenApply(layout: unknown, from: string): Promise<boolean> {
  const doc = parseLayoutDocument(typeof layout === 'string' ? layout : JSON.stringify(layout));
  if (!doc) {
    useToastStore.getState().push('The page changed but the new layout could not be read.', 'error', from);
    return false;
  }
  const ghosts = reducedMotion() ? [] : newRects(doc);
  if (ghosts.length > 0) {
    useGhostStore.getState().show(ghosts);
    await sleep(ghostDuration(ghosts.length));
  }
  const applied = await applyLayoutDocument(doc);
  useGhostStore.getState().clear();
  if (!applied) useToastStore.getState().push('The page changed but the new layout could not be applied.', 'error', from);
  return applied;
}
