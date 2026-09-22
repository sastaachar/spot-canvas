import { createHash, randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import type { Identity } from './config.ts';

const TOKEN_BYTES = 32;
const TOKEN_PREFIX = 'sc_';
const OWNER_ONLY = 0o600;

const RecordSchema = z.object({
  identity: z.object({ id: z.string(), name: z.string(), displayName: z.string(), cluster: z.string().optional() }),
  label: z.string(),
  createdAt: z.number()
});

const FileSchema = z.record(z.string(), RecordSchema);

type TokenRecord = z.infer<typeof RecordSchema>;

export interface TokenInfo {
  label: string;
  createdAt: number;
}

const hash = (token: string): string => createHash('sha256').update(token).digest('hex');

/** Personal access tokens for agents (MCP, scripts). Only hashes are stored. */
export class TokenStore {
  private readonly records = new Map<string, TokenRecord>();
  private readonly file: string | null;

  constructor(file: string | null = null) {
    this.file = file;
    if (file && existsSync(file)) {
      try {
        const parsed = FileSchema.safeParse(JSON.parse(readFileSync(file, 'utf8')));
        if (parsed.success) for (const [h, r] of Object.entries(parsed.data)) this.records.set(h, r);
      } catch {
        // a corrupt token file means no tokens, never a crash
      }
    }
  }

  private persist(): void {
    if (!this.file) return;
    mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(Object.fromEntries(this.records)), { encoding: 'utf8', mode: OWNER_ONLY });
    chmodSync(tmp, OWNER_ONLY);
    renameSync(tmp, this.file);
  }

  create(identity: Identity, label: string, now: number = Date.now()): string {
    const token = `${TOKEN_PREFIX}${randomBytes(TOKEN_BYTES).toString('base64url')}`;
    this.records.set(hash(token), { identity, label, createdAt: now });
    this.persist();
    return token;
  }

  resolve(token: string): Identity | null {
    return this.records.get(hash(token))?.identity ?? null;
  }

  list(userId: string): TokenInfo[] {
    return [...this.records.values()].filter((r) => r.identity.id === userId).map(({ label, createdAt }) => ({ label, createdAt }));
  }

  revokeAll(userId: string): number {
    let removed = 0;
    for (const [h, r] of this.records) {
      if (r.identity.id === userId) {
        this.records.delete(h);
        removed += 1;
      }
    }
    if (removed > 0) this.persist();
    return removed;
  }

  get size(): number {
    return this.records.size;
  }
}
