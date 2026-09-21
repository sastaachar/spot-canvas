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
  title: z.string().max(MAX_TITLE_LENGTH).nullable().optional(),
  groupId: z.string().max(MAX_ID_LENGTH).nullable().optional()
});

const MAX_GROUPS = 100;

export const GroupSchema = z.object({
  gid: z.string().min(1).max(MAX_ID_LENGTH),
  title: z.string().max(MAX_TITLE_LENGTH),
  x: finite,
  y: finite,
  w: finite,
  h: finite,
  color: z.enum(['blue', 'amber', 'green', 'violet', 'slate'])
});

export const PreferencesSchema = z.object({ theme: z.enum(['system', 'light', 'dark']) }).partial();

const MAX_SUITES = 50;
const MAX_SETTINGS_PER_SUITE = 40;
const MAX_SETTING_VALUE_LENGTH = 4096;
const MAX_URL_LENGTH = 2048;

const isLoadableUrl = (value: string): boolean => {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || (url.protocol === 'http:' && url.hostname === 'localhost');
  } catch {
    return false;
  }
};

export const SuiteStateSchema = z.object({
  url: z.string().max(MAX_URL_LENGTH).refine(isLoadableUrl, 'suite url must be https').nullable(),
  settings: z
    .record(
      z.string().min(1).max(MAX_ID_LENGTH),
      z.union([z.string().max(MAX_SETTING_VALUE_LENGTH), z.number().finite(), z.boolean()])
    )
    .refine((r) => Object.keys(r).length <= MAX_SETTINGS_PER_SUITE, 'too many settings'),
  configured: z.boolean()
});

export const LayoutSchema = z.object({
  version: z.literal(1),
  panels: z.array(PanelSchema).max(MAX_PANELS),
  suites: z
    .record(z.string().min(1).max(MAX_ID_LENGTH), SuiteStateSchema)
    .refine((r) => Object.keys(r).length <= MAX_SUITES, 'too many suites')
    .optional(),
  groups: z.array(GroupSchema).max(MAX_GROUPS).optional(),
  preferences: PreferencesSchema.optional()
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
