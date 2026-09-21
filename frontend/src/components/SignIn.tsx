import { useState, type FormEvent } from 'react';
import { useSession } from '../core/session';

export function SignIn() {
  const signIn = useSession((s) => s.signIn);
  const error = useSession((s) => s.error);
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const ok = await signIn(token);
    if (!ok) {
      setBusy(false);
      setToken('');
    }
  };

  return (
    <main className="signin">
      <form className="signin__card" onSubmit={submit}>
        <h1>Spot Canvas</h1>
        <p>Your ThoughtSpot homepage, arranged your way. Sign in to load it.</p>
        <label htmlFor="token">ThoughtSpot token</label>
        <input
          id="token"
          type="password"
          autoComplete="off"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          required
        />
        <button type="submit" className="tb-btn tb-btn--primary" disabled={busy || token.length === 0}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
        {error && (
          <p className="signin__error" role="alert">
            {error}
          </p>
        )}
      </form>
    </main>
  );
}
