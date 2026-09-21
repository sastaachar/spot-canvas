import { useState, type FormEvent } from 'react';
import { useSession } from '../core/session';

const LAST_CLUSTER_KEY = 'spot-canvas.last-cluster';

function rememberedCluster(): string {
  try {
    return localStorage.getItem(LAST_CLUSTER_KEY) ?? '';
  } catch {
    return '';
  }
}

function rememberCluster(url: string): void {
  try {
    localStorage.setItem(LAST_CLUSTER_KEY, url);
  } catch {
    // remembering the cluster is a convenience only
  }
}

export function SignIn() {
  const signIn = useSession((s) => s.signIn);
  const error = useSession((s) => s.error);
  const [clusterUrl, setClusterUrl] = useState(rememberedCluster);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const ready = clusterUrl.trim() !== '' && username.trim() !== '' && password !== '';

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!ready) return;
    setBusy(true);
    const ok = await signIn({ clusterUrl: clusterUrl.trim(), username: username.trim(), password });
    if (ok) {
      rememberCluster(clusterUrl.trim());
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
