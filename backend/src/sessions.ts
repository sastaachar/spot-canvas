import { randomBytes } from 'node:crypto';
import type { ClusterSession } from './auth.ts';
import type { Identity } from './config.ts';

export const SESSION_COOKIE = 'sc_session';
const SESSION_ID_BYTES = 32;
const MS_PER_SECOND = 1000;

interface Session {
  identity: Identity;
  cluster: ClusterSession | null;
  expiresAt: number;
}

export class SessionStore {
  private readonly sessions = new Map<string, Session>();
  private readonly ttlMs: number;
  private readonly now: () => number;

  constructor(ttlMs: number, now: () => number = Date.now) {
    this.ttlMs = ttlMs;
    this.now = now;
  }

  create(identity: Identity, cluster: ClusterSession | null = null): string {
    const sid = randomBytes(SESSION_ID_BYTES).toString('base64url');
    this.sessions.set(sid, { identity, cluster, expiresAt: this.now() + this.ttlMs });
    return sid;
  }

  private live(sid: string): Session | null {
    const session = this.sessions.get(sid);
    if (!session) return null;
    if (session.expiresAt <= this.now()) {
      this.sessions.delete(sid);
      return null;
    }
    return session;
  }

  get(sid: string): Identity | null {
    return this.live(sid)?.identity ?? null;
  }

  cluster(sid: string): ClusterSession | null {
    return this.live(sid)?.cluster ?? null;
  }

  delete(sid: string): void {
    this.sessions.delete(sid);
  }

  sweep(): void {
    const t = this.now();
    for (const [sid, session] of this.sessions) {
      if (session.expiresAt <= t) this.sessions.delete(sid);
    }
  }

  get size(): number {
    return this.sessions.size;
  }
}

export function parseCookies(header: string | undefined): Map<string, string> {
  const out = new Map<string, string>();
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const key = part.slice(0, i).trim();
    if (key) out.set(key, part.slice(i + 1).trim());
  }
  return out;
}

function cookie(value: string, maxAgeSeconds: number, secure: boolean): string {
  const parts = [`${SESSION_COOKIE}=${value}`, 'Path=/', 'HttpOnly', 'SameSite=Strict', `Max-Age=${maxAgeSeconds}`];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

export function sessionCookie(sid: string, ttlMs: number, secure: boolean): string {
  return cookie(sid, Math.floor(ttlMs / MS_PER_SECOND), secure);
}

export function clearSessionCookie(secure: boolean): string {
  return cookie('', 0, secure);
}
