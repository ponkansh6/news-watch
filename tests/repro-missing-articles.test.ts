import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../src/lib/db';
import { articles } from '../src/lib/db/schema';
import { getScoredArticles } from '../src/lib/db/actions';
import { eq } from 'drizzle-orm';

// Test 1: Polling Logic Premature Completion
describe('Polling Logic', () => {
  it('should evaluate true when totalScored >= totalFetched even if new articles are not scored', () => {
    // Mock data structure
    const fetchedResults = [{ keyword: 'test', fetched: 5, scored: 0, errors: [] }];
    const statusData = { status: [{ keyword: 'test', scored: 10 }] }; // 10 old articles

    const updatedResults = fetchedResults.map((r) => {
      const status = statusData.status.find((s: any) => s.keyword === r.keyword);
      return { ...r, scored: status?.scored ?? 0 };
    });

    const totalFetched = fetchedResults.reduce((acc, r) => acc + r.fetched, 0);
    const totalScored = updatedResults.reduce((acc, r) => acc + r.scored, 0);

    // 10 >= 5 is true
    expect(totalScored).toBe(10);
    expect(totalFetched).toBe(5);
    expect(totalScored >= totalFetched).toBe(true);
  });
});

// Test 2: Source Filtering
describe('Source Filtering', () => {
  beforeEach(async () => {
    // Clear database
    await db.delete(articles);
  });

  it('should filter articles by sourceId', async () => {
    // Insert article with sourceId 'gnews'
    await db.insert(articles).values({
      title: 'Test Article',
      url: 'https://example.com/1',
      keyword: 'test',
      sourceId: 'gnews',
      score: 10,
      publishedAt: new Date().toISOString(),
    });

    // Call getScoredArticles with 'hackernews'
    const result1 = await getScoredArticles(100, ['hackernews']);
    expect(result1.length).toBe(0);

    // Call getScoredArticles with 'gnews'
    const result2 = await getScoredArticles(100, ['gnews']);
    expect(result2.length).toBe(1);
    expect(result2[0].sourceId).toBe('gnews');
  });
});
