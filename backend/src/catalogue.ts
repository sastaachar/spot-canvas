import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { CataloguePluginSchema, type CataloguePlugin } from './agent/tools.ts';

const MAX_PLUGINS = 200;

export const CatalogueSchema = z.array(CataloguePluginSchema).max(MAX_PLUGINS);

/** The plugins a user's browser has registered, so agents that call the API directly know what can be added. */
export class CatalogueStore {
  private readonly dir: string;

  constructor(dir: string) {
    this.dir = dir;
  }

  async init(): Promise<void> {
    await mkdir(this.dir, { recursive: true });
  }

  private file(userId: string): string {
    return path.join(this.dir, `${createHash('sha256').update(userId).digest('hex')}.json`);
  }

  async read(userId: string): Promise<CataloguePlugin[]> {
    try {
      const parsed = CatalogueSchema.safeParse(JSON.parse(await readFile(this.file(userId), 'utf8')));
      return parsed.success ? parsed.data : [];
    } catch {
      return [];
    }
  }

  async write(userId: string, catalogue: CataloguePlugin[]): Promise<void> {
    const target = this.file(userId);
    const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tmp, JSON.stringify(catalogue), 'utf8');
    await rename(tmp, target);
  }
}
