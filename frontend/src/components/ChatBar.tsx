import { useEffect, useState, type FormEvent } from 'react';
import { useChatStore } from '../core/chat';

const REPLY_TTL_MS = 12_000;

export function ChatBar() {
  const [text, setText] = useState('');
  const pending = useChatStore((s) => s.pending);
  const lastReply = useChatStore((s) => s.lastReply);
  const error = useChatStore((s) => s.error);
  const send = useChatStore((s) => s.send);
  const dismiss = useChatStore((s) => s.dismiss);

  useEffect(() => {
    if (!lastReply) return;
    const timer = setTimeout(dismiss, REPLY_TTL_MS);
    return () => clearTimeout(timer);
  }, [lastReply, dismiss]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const message = text.trim();
    if (!message || pending) return;
    setText('');
    void send(message);
  };

  const bubble = error ?? lastReply;

  return (
    <div className="chat">
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
          disabled={pending}
          onChange={(e) => setText(e.target.value)}
        />
        <button type="submit" aria-label="Send" disabled={pending || !text.trim()}>
          ↑
        </button>
      </form>
    </div>
  );
}
