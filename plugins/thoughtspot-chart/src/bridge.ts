/**
 * Minimal request/response bridge over postMessage + MessageChannel, wire-compatible
 * with the `promise-postmessage` protocol the ThoughtSpot Chart SDK speaks: a request
 * carries a transferred MessagePort and the reply comes back on that port.
 */

/** Return this from a handler to leave a message unanswered (it belongs to someone else). */
export const SKIP: unique symbol = Symbol('skip');

export type MessageHandler = (data: unknown, event: MessageEvent) => unknown | Promise<unknown>;

/** Sends `data` to `target` and resolves with whatever the receiver posts back on the port. */
export function request(target: Window, data: unknown, targetOrigin = '*'): Promise<unknown> {
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = (e) => {
      channel.port1.close();
      resolve(e.data);
    };
    target.postMessage(data, targetOrigin, [channel.port2]);
  });
}

/**
 * Answers requests coming from `source()`. A handler's return value is posted back on the
 * request's port unless it is SKIP. Returns the function that stops listening.
 */
export function listen(source: () => Window | null, handler: MessageHandler): () => void {
  const onMessage = async (e: MessageEvent) => {
    const from = source();
    if (!from || e.source !== from) return;
    const result = await handler(e.data, e);
    if (result !== SKIP) e.ports[0]?.postMessage(result);
  };
  window.addEventListener('message', onMessage);
  return () => window.removeEventListener('message', onMessage);
}
