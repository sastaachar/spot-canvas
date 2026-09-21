import type { LayoutBackend } from './persistence';

export interface User {
  id: string;
  name: string;
  displayName: string;
  cluster?: string | null;
}

export interface Credentials {
  clusterUrl: string;
  username: string;
  password: string;
}

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

const API_BASE: string = (import.meta.env.VITE_API_URL as string | undefined) ?? '/api';
const CSRF_HEADER = 'X-Requested-With';
const CSRF_VALUE = 'SpotCanvas';

async function call(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set(CSRF_HEADER, CSRF_VALUE);
  if (init.body !== undefined) headers.set('Content-Type', 'application/json');
  return fetch(`${API_BASE}${path}`, { ...init, headers, credentials: 'include' });
}

const userOf = async (res: Response): Promise<User> => ((await res.json()) as { user: User }).user;

export async function fetchMe(): Promise<User | null> {
  const res = await call('/me');
  if (res.status === 401) return null;
  if (!res.ok) throw new ApiError(res.status, 'Could not load your session.');
  return userOf(res);
}

export async function signIn(credentials: Credentials): Promise<User> {
  const res = await call('/session', { method: 'POST', body: JSON.stringify(credentials) });
  if (res.status === 401) throw new ApiError(res.status, 'That username or password was not accepted by the cluster.');
  if (res.status === 400) {
    const body = (await res.json().catch(() => ({}))) as { message?: string };
    throw new ApiError(res.status, body.message ?? 'Check the cluster URL.');
  }
  if (res.status === 429) throw new ApiError(res.status, 'Too many attempts. Wait a minute and try again.');
  if (res.status === 502) throw new ApiError(res.status, 'The cluster could not be reached.');
  if (!res.ok) throw new ApiError(res.status, 'Sign-in failed.');
  return userOf(res);
}

export async function signOut(): Promise<void> {
  const res = await call('/session', { method: 'DELETE' });
  if (!res.ok) throw new ApiError(res.status, 'Sign-out failed.');
}

export const remoteLayoutBackend: LayoutBackend = {
  async read() {
    const res = await call('/layout');
    if (res.status === 204) return null;
    if (!res.ok) throw new ApiError(res.status, 'Could not load your homepage.');
    return res.text();
  },
  async write(json) {
    const res = await call('/layout', { method: 'PUT', body: json });
    if (!res.ok) throw new ApiError(res.status, 'Could not save your homepage.');
  }
};

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface ChatCataloguePlugin {
  id: string;
  name: string;
  kind: string;
  size: [number, number];
  suiteId?: string | null;
}

export interface ChatReply {
  reply: string;
  changed: boolean;
  actions: string[];
  layout?: unknown;
}

export async function sendChat(message: string, history: ChatTurn[], catalogue: ChatCataloguePlugin[]): Promise<ChatReply> {
  const res = await call('/chat', { method: 'POST', body: JSON.stringify({ message, history, catalogue }) });
  if (res.status === 503) throw new ApiError(res.status, 'Spotter chat is not configured on this server.');
  if (res.status === 429) throw new ApiError(res.status, 'Spotter is busy. Try again in a minute.');
  if (res.status === 502) throw new ApiError(res.status, 'Spotter could not reach the model.');
  if (!res.ok) throw new ApiError(res.status, 'Spotter could not answer.');
  return (await res.json()) as ChatReply;
}
