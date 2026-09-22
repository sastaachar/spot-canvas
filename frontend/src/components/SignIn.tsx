import { useState, type FormEvent } from 'react';
import { useSession } from '../core/session';

const LAST_CLUSTER_KEY = 'spot-canvas.last-cluster';
const LAST_USERNAME_KEY = 'spot-canvas.last-username';

// Cluster URL and username are remembered to save typing; the password never is.
function remembered(key: string): string {
  try {
    return localStorage.getItem(key) ?? '';
  } catch {
    return '';
  }
}

function remember(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // remembering is a convenience only
  }
}

export function SignIn() {
  const signIn = useSession((s) => s.signIn);
  const error = useSession((s) => s.error);
  const [clusterUrl, setClusterUrl] = useState(() => remembered(LAST_CLUSTER_KEY));
  const [username, setUsername] = useState(() => remembered(LAST_USERNAME_KEY));
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const ready = clusterUrl.trim() !== '' && username.trim() !== '' && password !== '';

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!ready) return;
    setBusy(true);
    const ok = await signIn({ clusterUrl: clusterUrl.trim(), username: username.trim(), password });
    if (ok) {
      remember(LAST_CLUSTER_KEY, clusterUrl.trim());
      remember(LAST_USERNAME_KEY, username.trim());
      return;
    }
    setBusy(false);
    setPassword('');
  };

  return (
    <main className="signin">
      <form className="signin__card" onSubmit={submit}>
        <h1>Spot Canvas</h1>
        <p>Your ThoughtSpot homepage, arranged your way. Sign in to your cluster to load it.</p>
        <label htmlFor="cluster">Cluster URL</label>
        <input
          id="cluster"
          type="text"
          inputMode="url"
          autoComplete="url"
          placeholder="my-company.thoughtspot.cloud"
          value={clusterUrl}
          onChange={(e) => setClusterUrl(e.target.value)}
          required
        />
        <label htmlFor="username">Username</label>
        <input id="username" type="text" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} required />
        <label htmlFor="password">Password</label>
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        <button type="submit" className="tb-btn tb-btn--primary" disabled={busy || !ready}>
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
