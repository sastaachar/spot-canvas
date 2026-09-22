import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent
} from 'react';
import { useChatStore } from '../core/chat';

const REPLY_TTL_MS = 12_000;
const DRAG_MARGIN = 8;
// Room kept above the pinned bar so the transcript always has space to expand
// upward without clipping (matches the expanded bar's min-height).
const EXPAND_RESERVE = 260;

export function ChatBar() {
  const [text, setText] = useState('');
  const [expanded, setExpanded] = useState(false);
  const turns = useChatStore((s) => s.turns);
  const pending = useChatStore((s) => s.pending);
  const lastReply = useChatStore((s) => s.lastReply);
  const error = useChatStore((s) => s.error);
  const send = useChatStore((s) => s.send);
  const dismiss = useChatStore((s) => s.dismiss);
  const rootRef = useRef<HTMLDivElement>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  // null = default (centred at the bottom). Once dragged we pin the INPUT BAR
  // by its bottom-left corner: it stays put whether collapsed or expanded, and
  // the transcript grows upward from it (never teleports between states).
  const [pos, setPos] = useState<{ left: number; bottom: number } | null>(null);
  const dragOffset = useRef<{ dx: number; dyBottom: number } | null>(null);

  // Clamp the pinned bar into the viewport, reserving room above it to expand.
  const clampPos = (left: number, bottom: number, width: number) => ({
    left: Math.max(DRAG_MARGIN, Math.min(left, window.innerWidth - width - DRAG_MARGIN)),
    bottom: Math.max(DRAG_MARGIN, Math.min(bottom, window.innerHeight - EXPAND_RESERVE - DRAG_MARGIN))
  });

  const onDragStart = (e: ReactPointerEvent<HTMLElement>) => {
    const el = rootRef.current;
    if (!el || e.button !== 0) return;
    const rect = el.getBoundingClientRect();
    dragOffset.current = { dx: e.clientX - rect.left, dyBottom: rect.bottom - e.clientY };
    e.currentTarget.setPointerCapture(e.pointerId);
    e.preventDefault();
  };

  const onDragMove = (e: ReactPointerEvent<HTMLElement>) => {
    const offset = dragOffset.current;
    const el = rootRef.current;
    if (!offset || !el) return;
    const bottomFromTop = e.clientY + offset.dyBottom; // box bottom in viewport coords
    setPos(clampPos(e.clientX - offset.dx, window.innerHeight - bottomFromTop, el.offsetWidth));
  };

  const onDragEnd = (e: ReactPointerEvent<HTMLElement>) => {
    dragOffset.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  };

  // Bottom-anchored so expanding grows the transcript upward (bar fixed);
  // --chat-max caps that growth to the room above so it can't clip the top.
  const dragStyle: CSSProperties | undefined = pos
    ? ({
        position: 'fixed',
        left: pos.left,
        bottom: pos.bottom,
        top: 'auto',
        right: 'auto',
        transform: 'none',
        margin: 0,
        '--chat-max': `${window.innerHeight - pos.bottom - DRAG_MARGIN}px`
      } as CSSProperties)
    : undefined;

  // Keep a pinned bar inside the viewport when the window is resized.
  useEffect(() => {
    if (!pos) return;
    const onResize = () => {
      const width = rootRef.current?.offsetWidth ?? 0;
      setPos((p) => (p ? clampPos(p.left, p.bottom, width) : p));
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [pos]);

  // Collapsed: the last reply floats above the bar for a while. Expanded: the transcript shows it.
  useEffect(() => {
    if (!lastReply || expanded) return;
    const timer = setTimeout(dismiss, REPLY_TTL_MS);
    return () => clearTimeout(timer);
  }, [lastReply, expanded, dismiss]);

  useEffect(() => {
    if (!expanded) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setExpanded(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setExpanded(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [expanded]);

  useEffect(() => {
    const log = logRef.current;
    if (expanded && log) log.scrollTop = log.scrollHeight;
  }, [expanded, turns.length, pending]);

  const sendMessage = () => {
    const message = text.trim();
    if (!message || pending) return;
    setText('');
    void send(message);
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    sendMessage();
  };

  // Enter sends; Shift+Enter (and IME composition) inserts a newline.
  const onInputKeyDown = (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      sendMessage();
    }
  };

  // Grow the box with the text (up to the CSS max-height, then it scrolls).
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [text, expanded]);

  const bubble = expanded ? null : error ?? lastReply;

  return (
    <div ref={rootRef} className={`chat${expanded ? ' is-expanded' : ''}${pos ? ' is-floating' : ''}`} style={dragStyle}>
      {bubble && (
        <div className={`chat__bubble${error ? ' is-error' : ''}`} role="status">
          <span>{bubble}</span>
          <button type="button" aria-label="Dismiss reply" onClick={dismiss}>
            ✕
          </button>
        </div>
      )}
      <form className={`chatbar${pending ? ' is-pending' : ''}`} onSubmit={submit} aria-label="Ask Spotter">
        <div ref={logRef} className="chat__log" role="log" aria-label="Spotter conversation" aria-hidden={!expanded} data-testid="chat-log">
          {expanded && turns.length === 0 && !pending && !error && (
            <p className="chat__hint">
              Ask for changes to your homepage or questions about your data. Try “add a note for standup in a Today group” or “build my
              homepage from what I used last quarter”.
            </p>
          )}
          {expanded &&
            turns.map((turn, i) => (
              <div key={`${i}-${turn.role}`} className={`chat__turn chat__turn--${turn.role}`}>
                {turn.actions && turn.actions.length > 0 && (
                  <ul className="chat__tools" aria-label="Tool calls">
                    {turn.actions.map((a, j) => (
                      <li key={`${j}-${a.tool}`} className={`chat__tool${a.changed ? ' is-change' : ''}`} title={a.tool}>
                        <span className="chat__tool-mark" aria-hidden="true">
                          {a.changed ? '✎' : '⌕'}
                        </span>
                        {a.summary}
                      </li>
                    ))}
                  </ul>
                )}
                <div className={`chat__msg chat__msg--${turn.role}`}>{turn.content}</div>
              </div>
            ))}
          {expanded && pending && (
            <div className="chat__msg chat__msg--assistant is-pending" role="status">
              Spotter is working…
            </div>
          )}
          {expanded && error && (
            <div className="chat__msg chat__msg--error" role="alert">
              {error}
            </div>
          )}
        </div>
        <div className="chatbar__row">
          <span
            className="chatbar__drag"
            role="button"
            aria-label="Drag to move Spotter"
            title="Drag to move"
            onPointerDown={onDragStart}
            onPointerMove={onDragMove}
            onPointerUp={onDragEnd}
            onPointerCancel={onDragEnd}
          >
            <span aria-hidden="true">⠿</span>
          </span>
          <textarea
            ref={inputRef}
            rows={1}
            value={text}
            placeholder={pending ? 'Spotter is working…' : 'Ask Spotter to change your homepage or your data…'}
            aria-label="Message Spotter"
            aria-expanded={expanded}
            disabled={pending}
            onFocus={() => setExpanded(true)}
            onPointerDown={() => setExpanded(true)}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onInputKeyDown}
          />
          {expanded && (
            <button type="button" className="chatbar__collapse" aria-label="Collapse" onClick={() => setExpanded(false)}>
              ⌄
            </button>
          )}
          <button type="submit" aria-label="Send" disabled={pending || !text.trim()}>
            ↑
          </button>
        </div>
      </form>
    </div>
  );
}
