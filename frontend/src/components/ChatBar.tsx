import { useState, type FormEvent } from 'react';
import { useToastStore } from '../core/toasts';

const COMING_SOON = 'Spotter chat is next: the agent will build and edit this page for you.';

export function ChatBar() {
  const [text, setText] = useState('');

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    useToastStore.getState().push(COMING_SOON, 'info', 'spotter');
    setText('');
  };

  return (
    <form className="chatbar" onSubmit={submit} aria-label="Ask Spotter">
      <span className="chatbar__mark" aria-hidden="true" />
      <input
        type="text"
        value={text}
        placeholder="Ask Spotter to change your homepage or your data…"
        aria-label="Message Spotter"
        onChange={(e) => setText(e.target.value)}
      />
      <button type="submit" aria-label="Send" disabled={!text.trim()}>
        ↑
      </button>
    </form>
  );
}
