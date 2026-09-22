import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useChatStore } from '../core/chat';

const REPLY_TTL_MS = 12_000;

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

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const message = text.trim();
    if (!message || pending) return;
    setText('');
    void send(message);
  };

  const bubble = expanded ? null : error ?? lastReply;

  return (
    <div ref={rootRef} className={`chat${expanded ? ' is-expanded' : ''}`}>
      {expanded && (
        <section className="chat__panel" role="dialog" aria-label="Spotter conversation">
          <header className="chat__panel-head">
            <span className="chatbar__mark" aria-hidden="true" />
            <h2>Spotter</h2>
            <button type="button" aria-label="Collapse" onClick={() => setExpanded(false)}>
              ✕
            </button>
          </header>
          <div ref={logRef} className="chat__log" aria-live="polite">
            {turns.length === 0 && !pending && (
              <p className="chat__hint">
                Ask for changes to your homepage or questions about your data. Try “add a note for standup in a Today group” or “build my
                homepage from what I used last quarter”.
              </p>
            )}
            {turns.map((turn, i) => (
              <div key={`${i}-${turn.role}`} className={`chat__msg chat__msg--${turn.role}`}>
                {turn.content}
              </div>
            ))}
            {pending && (
              <div className="chat__msg chat__msg--assistant is-pending" role="status">
                Spotter is working…
              </div>
            )}
            {error && (
              <div className="chat__msg chat__msg--error" role="alert">
                {error}
              </div>
            )}
          </div>
        </section>
      )}
      {bubble && (
        <div className={`chat__bubble${error ? ' is-error' : ''}`} role="status">
          <span>{bubble}</span>
          <button type="button" aria-label="Dismiss reply" onClick={dismiss}>
            ✕
          </button>
        </div>
      )}
      <form className={`chatbar${pending ? ' is-pending' : ''}`} onSubmit={submit} aria-label="Ask Spotter">
        <span className="chatbar__mark" aria-hidden="true" />
        <input
          type="text"
          value={text}
          placeholder={pending ? 'Spotter is working…' : 'Ask Spotter to change your homepage or your data…'}
          aria-label="Message Spotter"
          aria-expanded={expanded}
          disabled={pending}
          onFocus={() => setExpanded(true)}
          onPointerDown={() => setExpanded(true)}
          onChange={(e) => setText(e.target.value)}
        />
        <button type="submit" aria-label="Send" disabled={pending || !text.trim()}>
          ↑
        </button>
      </form>
    </div>
  );
}
