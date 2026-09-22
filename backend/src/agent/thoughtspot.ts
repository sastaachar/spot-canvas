import { z } from 'zod';
import { REQUESTED_BY_HEADER, type ClusterSession, type FetchLike } from '../auth.ts';

export type ObjectType = 'liveboard' | 'answer';

export interface ThoughtSpotObject {
  id: string;
  name: string;
  type: ObjectType;
  description?: string;
  author?: string;
  modified?: string;
  last_accessed?: string;
  views?: number;
  is_favorite?: boolean;
}

export class ThoughtSpotError extends Error {
  override name = 'ThoughtSpotError';
}

const REQUEST_TIMEOUT_MS = 20_000;
const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 100;
const V1_BATCH = 100;
const MAX_V1_PAGES = 10;
const MS_PER_DAY = 86_400_000;

const V1_TYPE: Record<ObjectType, string> = { liveboard: 'PINBOARD_ANSWER_BOOK', answer: 'QUESTION_ANSWER_BOOK' };
const V2_TYPE: Record<ObjectType, string> = { liveboard: 'LIVEBOARD', answer: 'ANSWER' };
const FROM_V1: Record<string, ObjectType> = { PINBOARD_ANSWER_BOOK: 'liveboard', QUESTION_ANSWER_BOOK: 'answer' };
const FROM_V2: Record<string, ObjectType> = { LIVEBOARD: 'liveboard', ANSWER: 'answer' };

const V1ListSchema = z.object({
  objects: z.array(
    z.object({
      header: z.object({
        id: z.string(),
        name: z.string(),
        description: z.string().optional(),
        authorName: z.string().optional(),
        modified: z.number().optional()
      }),
      type: z.string().optional(),
      isFavorite: z.boolean().optional(),
      stats: z.object({ views: z.number().optional(), lastAccessed: z.number().optional() }).partial().optional()
    })
  ),
  isLastBatch: z.boolean().optional()
});

const V2SearchSchema = z.array(
  z.object({
    metadata_id: z.string(),
    metadata_name: z.string(),
    metadata_type: z.string(),
    metadata_header: z
      .object({ description: z.string().optional(), authorName: z.string().optional(), modified: z.number().optional() })
      .partial()
      .optional()
  })
);

const iso = (epochMs: number | undefined): string | undefined => (epochMs ? new Date(epochMs).toISOString() : undefined);

export class ThoughtSpotClient {
  private readonly cluster: ClusterSession;
  private readonly fetchImpl: FetchLike;
  private readonly now: () => number;

  constructor(cluster: ClusterSession, fetchImpl: FetchLike = fetch, now: () => number = Date.now) {
    this.cluster = cluster;
    this.fetchImpl = fetchImpl;
    this.now = now;
  }

  get host(): string {
    return this.cluster.host;
  }

  private async request(path: string, init: RequestInit = {}): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.cluster.host}${path}`, {
        ...init,
        headers: {
          Cookie: this.cluster.cookie,
          Accept: 'application/json',
          ...REQUESTED_BY_HEADER,
          ...(init.headers as Record<string, string> | undefined)
        },
        signal: controller.signal
      });
    } catch {
      throw new ThoughtSpotError('The cluster is unreachable');
    } finally {
      clearTimeout(timer);
    }
    if (res.status === 401 || res.status === 403) throw new ThoughtSpotError('The cluster session has expired; sign in again');
    if (!res.ok) throw new ThoughtSpotError(`The cluster answered ${res.status}`);
    try {
      return await res.json();
    } catch {
      throw new ThoughtSpotError('The cluster returned a non-JSON body');
    }
  }

  private async listWithStats(sort: 'LAST_ACCESSED' | 'VIEWS', types: ObjectType[], offset: number): Promise<z.infer<typeof V1ListSchema>> {
    const params = new URLSearchParams({
      sort,
      sortascending: 'false',
      type: JSON.stringify(types.map((t) => V1_TYPE[t])),
      batchsize: String(V1_BATCH),
      offset: String(offset),
      category: 'ALL'
    });
    const parsed = V1ListSchema.safeParse(await this.request(`/callosum/v1/metadata/list/withstats?${params}`));
    if (!parsed.success) throw new ThoughtSpotError('The cluster returned an unexpected list payload');
    return parsed.data;
  }

  private static fromV1(o: z.infer<typeof V1ListSchema>['objects'][number], fallback: ObjectType): ThoughtSpotObject {
    return {
      id: o.header.id,
      name: o.header.name,
      type: FROM_V1[o.type ?? ''] ?? fallback,
      ...(o.header.description ? { description: o.header.description } : {}),
      ...(o.header.authorName ? { author: o.header.authorName } : {}),
      ...(iso(o.header.modified) ? { modified: iso(o.header.modified) } : {}),
      ...(iso(o.stats?.lastAccessed) ? { last_accessed: iso(o.stats?.lastAccessed) } : {}),
      ...(o.stats?.views !== undefined ? { views: o.stats.views } : {}),
      ...(o.isFavorite !== undefined ? { is_favorite: o.isFavorite } : {})
    };
  }

  /** Objects this user opened in the last `days`, most recent first (per-user lastAccessed from v1). */
  async recentActivity(days: number, limit: number = DEFAULT_LIMIT, types: ObjectType[] = ['liveboard', 'answer']): Promise<ThoughtSpotObject[]> {
    const since = this.now() - days * MS_PER_DAY;
    const out: ThoughtSpotObject[] = [];
    for (let page = 0; page < MAX_V1_PAGES && out.length < Math.min(limit, MAX_LIMIT); page += 1) {
      const batch = await this.listWithStats('LAST_ACCESSED', types, page * V1_BATCH);
      let stop = batch.objects.length === 0 || batch.isLastBatch === true;
      for (const o of batch.objects) {
        const at = o.stats?.lastAccessed;
        if (!at || at < since) {
          stop = true;
          break;
        }
        out.push(ThoughtSpotClient.fromV1(o, types[0] ?? 'liveboard'));
        if (out.length >= Math.min(limit, MAX_LIMIT)) break;
      }
      if (stop) break;
    }
    return out;
  }

  /** The user's favourites in their own order. */
  async favorites(types: ObjectType[] = ['liveboard', 'answer']): Promise<ThoughtSpotObject[]> {
    const params = new URLSearchParams({ type: JSON.stringify(types.map((t) => V1_TYPE[t])), batchsize: '-1', sortascending: 'false' });
    const parsed = V1ListSchema.safeParse(await this.request(`/callosum/v1/metadata/favorites/orderedList?${params}`));
    if (!parsed.success) throw new ThoughtSpotError('The cluster returned an unexpected favourites payload');
    return parsed.data.objects.map((o) => ({ ...ThoughtSpotClient.fromV1(o, types[0] ?? 'liveboard'), is_favorite: true }));
  }

  /** Name search across liveboards and answers (v2 metadata/search). */
  async search(query: string, types: ObjectType[] = ['liveboard', 'answer'], limit: number = DEFAULT_LIMIT): Promise<ThoughtSpotObject[]> {
    const pattern = query.trim() ? `%${query.trim()}%` : undefined;
    const body = {
      metadata: types.map((t) => ({ type: V2_TYPE[t], ...(pattern ? { name_pattern: pattern } : {}) })),
      record_offset: 0,
      record_size: Math.min(limit, MAX_LIMIT),
      include_headers: true,
      sort_options: { field_name: 'MODIFIED', order: 'DESC' }
    };
    const parsed = V2SearchSchema.safeParse(
      await this.request('/api/rest/2.0/metadata/search', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    );
    if (!parsed.success) throw new ThoughtSpotError('The cluster returned an unexpected search payload');
    return parsed.data.map((o) => ({
      id: o.metadata_id,
      name: o.metadata_name,
      type: FROM_V2[o.metadata_type] ?? 'liveboard',
      ...(o.metadata_header?.description ? { description: o.metadata_header.description } : {}),
      ...(o.metadata_header?.authorName ? { author: o.metadata_header.authorName } : {}),
      ...(iso(o.metadata_header?.modified) ? { modified: iso(o.metadata_header?.modified) } : {})
    }));
  }
}
