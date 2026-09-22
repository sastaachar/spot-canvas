import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
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

const PersistedSchema = z.record(
  z.string(),
  z.object({
    identity: z.object({ id: z.string(), name: z.string(), displayName: z.string(), cluster: z.string().optional() }),
    cluster: z.object({ host: z.string(), cookie: z.string(), expiresAt: z.number() }).nullable(),
    expiresAt: z.number()
  })
);

const OWNER_ONLY = 0o600;

/**
 * Sessions live in memory and, when a file is given, are mirrored to it so a
 * backend restart does not sign everyone out. The file holds cluster cookies,
 * so it is owner-readable only.
 */
export class SessionStore {
  private readonly sessions = new Map<string, Session>();
  private readonly ttlMs: number;
  private readonly now: () => number;
  private readonly file: string | null;

  constructor(ttlMs: number, now: () => number = Date.now, file: string | null = null) {
    this.ttlMs = ttlMs;
    this.now = now;
    this.file = file;
    if (file) this.load(file);
  }

  private load(file: string): void {
    if (!existsSync(file)) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(file, 'utf8'));
    } catch {
      return;
    }
    const result = PersistedSchema.safeParse(parsed);
    if (!result.success) return;
    const t = this.now();
    for (const [sid, session] of Object.entries(result.data)) {
      if (session.expiresAt > t) this.sessions.set(sid, session);
    }
  }

  private persist(): void {
    if (!this.file) return;
    mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(Object.fromEntries(this.sessions)), { encoding: 'utf8', mode: OWNER_ONLY });
    chmodSync(tmp, OWNER_ONLY);
    renameSync(tmp, this.file);
  }

  create(identity: Identity, cluster: ClusterSession | null = null): string {
    const sid = randomBytes(SESSION_ID_BYTES).toString('base64url');
    this.sessions.set(sid, { identity, cluster, expiresAt: this.now() + this.ttlMs });
    this.persist();
    return sid;
  }

  private live(sid: string): Session | null {
    const session = this.sessions.get(sid);
    if (!session) return null;
    if (session.expiresAt <= this.now()) {
      this.sessions.delete(sid);
      this.persist();
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

  /** Slide the expiry forward once the session is past half its life. Returns true when it did. */
  touch(sid: string): boolean {
    const session = this.live(sid);
    if (!session) return false;
    const remaining = session.expiresAt - this.now();
    if (remaining > this.ttlMs / 2) return false;
    session.expiresAt = this.now() + this.ttlMs;
    this.persist();
    return true;
  }

  delete(sid: string): void {
    if (this.sessions.delete(sid)) this.persist();
  }

  sweep(): void {
    const t = this.now();
    let removed = false;
    for (const [sid, session] of this.sessions) {
      if (session.expiresAt <= t) {
        this.sessions.delete(sid);
        removed = true;
      }
    }
    if (removed) this.persist();
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
