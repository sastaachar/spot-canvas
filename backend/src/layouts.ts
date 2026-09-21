import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';

const MAX_PANELS = 200;
const MAX_ID_LENGTH = 200;
const MAX_TITLE_LENGTH = 200;

const finite = z.number().finite();

export const PanelSchema = z.object({
  iid: z.string().min(1).max(MAX_ID_LENGTH),
  pluginId: z.string().min(1).max(MAX_ID_LENGTH),
  x: finite,
  y: finite,
  w: finite,
  h: finite,
  z: finite,
  data: z.unknown(),
  title: z.string().max(MAX_TITLE_LENGTH).nullable().optional()
});

export const LayoutSchema = z.object({
  version: z.literal(1),
  panels: z.array(PanelSchema).max(MAX_PANELS)
});

export type Layout = z.infer<typeof LayoutSchema>;

export class LayoutStore {
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

  async read(userId: string): Promise<Layout | null> {
    let raw: string;
    try {
      raw = await readFile(this.file(userId), 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
    try {
      const parsed = LayoutSchema.safeParse(JSON.parse(raw));
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  }

  async write(userId: string, layout: Layout): Promise<void> {
    const target = this.file(userId);
    const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tmp, JSON.stringify(layout), 'utf8');
    await rename(tmp, target);
  }
}
