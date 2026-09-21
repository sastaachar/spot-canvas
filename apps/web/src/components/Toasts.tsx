import { useEffect } from 'react';
import { TOAST_TTL_MS, useToastStore, type Toast } from '../core/toasts';

export function Toasts() {
  const toasts = useToastStore((s) => s.toasts);
  if (toasts.length === 0) return null;
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} />
      ))}
    </div>
  );
}

function ToastItem({ toast }: { toast: Toast }) {
  const dismiss = useToastStore((s) => s.dismiss);
  useEffect(() => {
    const handle = setTimeout(() => dismiss(toast.id), TOAST_TTL_MS);
    return () => clearTimeout(handle);
  }, [toast.id, dismiss]);
  return (
    <div className={`toast toast--${toast.kind}`}>
      <span className="toast__from">{toast.from.split('#')[0]}</span>
      <span className="toast__text">{toast.message}</span>
      <button type="button" aria-label="Dismiss" onClick={() => dismiss(toast.id)}>
        ✕
      </button>
    </div>
  );
}
