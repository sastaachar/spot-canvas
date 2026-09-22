import { describe, expect, it, vi } from 'vitest';
import { ThoughtSpotClient, ThoughtSpotError } from './thoughtspot.ts';

const cluster = { host: 'https://ts.example.com', token: 'tok', expiresAt: 0 };
const NOW = 1_700_000_000_000;
const DAY = 86_400_000;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

const v1 = (id: string, name: string, type: string, lastAccessed: number, extra: Record<string, unknown> = {}) => ({
  header: { id, name, authorName: 'Ann', modified: NOW - DAY },
  type,
  isFavorite: false,
  stats: { views: 3, lastAccessed },
  ...extra
});

describe('ThoughtSpotClient', () => {
  it('pages recent activity with the bearer token and stops at the day window', async () => {
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      expect((init?.headers as Record<string, string>)['Authorization']).toBe('Bearer tok');
      const offset = Number(new URL(url).searchParams.get('offset'));
      expect(new URL(url).searchParams.get('sort')).toBe('LAST_ACCESSED');
      if (offset === 0) {
        return json({
          objects: Array.from({ length: 100 }, (_, i) => v1(`a${i}`, `Answer ${i}`, 'QUESTION_ANSWER_BOOK', NOW - i * DAY)),
          isLastBatch: false
        });
      }
      return json({ objects: [v1('old', 'Old', 'PINBOARD_ANSWER_BOOK', NOW - 200 * DAY), v1('older', 'Older', 'PINBOARD_ANSWER_BOOK', NOW - 300 * DAY)], isLastBatch: true });
    });
    const client = new ThoughtSpotClient(cluster, fetchImpl, () => NOW);
    const recent = await client.recentActivity(90, 100);
    expect(recent).toHaveLength(91);
    expect(recent[0]).toMatchObject({ id: 'a0', name: 'Answer 0', type: 'answer', views: 3, author: 'Ann', is_favorite: false });
    expect(recent[0]!.last_accessed).toBe(new Date(NOW).toISOString());
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    const spread = new ThoughtSpotClient(cluster, async (url: string) => {
      const offset = Number(new URL(url).searchParams.get('offset'));
      return offset === 0
        ? json({ objects: Array.from({ length: 100 }, (_, i) => v1(`p${i}`, `P ${i}`, 'PINBOARD_ANSWER_BOOK', NOW - i * 60_000)), isLastBatch: false })
        : json({ objects: [v1('late', 'Late', 'PINBOARD_ANSWER_BOOK', NOW - DAY), v1('old', 'Old', 'PINBOARD_ANSWER_BOOK', NOW - 200 * DAY)], isLastBatch: true });
    }, () => NOW);
    const paged = await spread.recentActivity(90, 100);
    expect(paged).toHaveLength(100);
    expect(paged.at(-1)!.id).toBe('p99');
    const more = await new ThoughtSpotClient(cluster, async (url: string) => {
      const offset = Number(new URL(url).searchParams.get('offset'));
      return offset === 0
        ? json({ objects: Array.from({ length: 100 }, (_, i) => v1(`p${i}`, `P ${i}`, 'PINBOARD_ANSWER_BOOK', NOW - i * 60_000)), isLastBatch: false })
        : json({ objects: [v1('late', 'Late', 'PINBOARD_ANSWER_BOOK', NOW - DAY)], isLastBatch: true });
    }, () => NOW).recentActivity(90, 100);
    expect(more).toHaveLength(100);

    const few = await client.recentActivity(90, 5);
    expect(few).toHaveLength(5);
  });

  it('lists favourites and searches by name through v2', async () => {
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes('/favorites/orderedList')) {
        return json({ objects: [v1('f1', 'Fav', 'PINBOARD_ANSWER_BOOK', NOW)] });
      }
      expect(url).toBe('https://ts.example.com/api/rest/2.0/metadata/search');
      const body = JSON.parse(String(init?.body)) as { metadata: Array<{ type: string; name_pattern?: string }>; record_size: number };
      expect(body.metadata).toEqual([{ type: 'LIVEBOARD', name_pattern: '%sales%' }, { type: 'ANSWER', name_pattern: '%sales%' }]);
      expect(body.record_size).toBe(5);
      return json([{ metadata_id: 'lb', metadata_name: 'Sales', metadata_type: 'LIVEBOARD', metadata_header: { description: 'd', authorName: 'Bo', modified: NOW } }]);
    });
    const client = new ThoughtSpotClient(cluster, fetchImpl, () => NOW);
    expect(await client.favorites()).toEqual([
      expect.objectContaining({ id: 'f1', name: 'Fav', type: 'liveboard', is_favorite: true })
    ]);
    expect(await client.search(' sales ', undefined, 5)).toEqual([
      { id: 'lb', name: 'Sales', type: 'liveboard', description: 'd', author: 'Bo', modified: new Date(NOW).toISOString() }
    ]);
    const empty = vi.fn(async (_u: string, init?: RequestInit) => {
      expect(JSON.parse(String(init?.body)).metadata[0]).toEqual({ type: 'LIVEBOARD' });
      return json([]);
    });
    expect(await new ThoughtSpotClient(cluster, empty).search('', ['liveboard'])).toEqual([]);
  });

  it('maps failures to ThoughtSpotError', async () => {
    const cases: Array<[() => Promise<Response>, RegExp]> = [
      [
        async () => {
          throw new Error('down');
        },
        /unreachable/
      ],
      [async () => json({}, 401), /expired/],
      [async () => json({}, 500), /answered 500/],
      [async () => new Response('nope', { status: 200 }), /non-JSON/],
      [async () => json({ objects: 'bad' }), /unexpected list/]
    ];
    for (const [fetchImpl, pattern] of cases) {
      const client = new ThoughtSpotClient(cluster, fetchImpl);
      await expect(client.recentActivity(30)).rejects.toThrow(pattern);
      await expect(client.recentActivity(30)).rejects.toBeInstanceOf(ThoughtSpotError);
    }
    await expect(new ThoughtSpotClient(cluster, async () => json({ nope: 1 })).favorites()).rejects.toThrow(/unexpected favourites/);
    await expect(new ThoughtSpotClient(cluster, async () => json({ nope: 1 })).search('x')).rejects.toThrow(/unexpected search/);
  });
});
