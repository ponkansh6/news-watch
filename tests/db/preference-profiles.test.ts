import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Mock client exposure for in-memory DB execution
vi.mock("@/lib/db", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, any>;
  return { ...actual, __client: (actual as any).db.$client };
});

import * as dbMod from "@/lib/db";
import * as schemaMod from "../../src/lib/db/schema";
import {
  savePreferenceProfile,
  getLatestPreferenceProfile,
  getFavoriteStats,
} from "../../src/lib/db";

const CREATE_ARTICLES_SQL = `
  CREATE TABLE IF NOT EXISTS articles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT,
    url TEXT NOT NULL UNIQUE,
    url_to_image TEXT,
    published_at TEXT NOT NULL,
    source_name TEXT,
    source_id TEXT,
    author TEXT,
    keyword TEXT NOT NULL,
    summary TEXT,
    relevance REAL,
    usefulness REAL,
    recency REAL,
    recency_refreshed_at TEXT,
    reason TEXT,
    scored_at TEXT,
    score REAL,
    embedding TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
  )
`;

const CREATE_FAVORITES_SQL = `
  CREATE TABLE IF NOT EXISTS favorites (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    article_id INTEGER NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
  )
`;

const CREATE_PREFERENCE_PROFILES_SQL = `
  CREATE TABLE IF NOT EXISTS preference_profiles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    version INTEGER NOT NULL DEFAULT 1,
    analysis TEXT NOT NULL,
    prompt_section TEXT NOT NULL,
    favorite_count INTEGER NOT NULL,
    favorite_max_id INTEGER NOT NULL,
    model TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
  )
`;

beforeAll(async () => {
  await (dbMod as any).__client.execute(CREATE_ARTICLES_SQL);
  await (dbMod as any).__client.execute(CREATE_FAVORITES_SQL);
  await (dbMod as any).__client.execute(CREATE_PREFERENCE_PROFILES_SQL);
});

beforeEach(async () => {
  await (dbMod as any).__client.execute("DELETE FROM preference_profiles");
  await (dbMod as any).__client.execute("DELETE FROM favorites");
  await (dbMod as any).__client.execute("DELETE FROM articles");
});

describe("Preference Profiles DB Layer", () => {
  const sampleAnalysis = {
    themes: ["TypeScript", "Next.js"],
    traits: ["Deep dive"],
    dislikes: ["Clickbait"],
    scoringGuidance: ["Prioritize code examples"],
    summary: "Test summary preference",
  };

  it("1. save -> getLatest returns newest", async () => {
    await savePreferenceProfile({
      analysis: sampleAnalysis,
      promptSection: "section 1",
      favoriteCount: 3,
      favoriteMaxId: 10,
      notForMeCount: 0,
      notForMeMaxId: 0,
      model: "gemini-model-v1",
    });

    const analysis2 = { ...sampleAnalysis, summary: "Updated summary" };
    await savePreferenceProfile({
      analysis: analysis2,
      promptSection: "section 2",
      favoriteCount: 4,
      favoriteMaxId: 12,
      notForMeCount: 0,
      notForMeMaxId: 0,
      model: "gemini-model-v1",
    });

    const latest = await getLatestPreferenceProfile();
    expect(latest).not.toBeNull();
    expect(latest?.id).toBe(2);
    expect(latest?.promptSection).toBe("section 2");
    expect(latest?.favoriteCount).toBe(4);
    expect(latest?.favoriteMaxId).toBe(12);
    expect(latest?.analysis).toEqual(analysis2);
  });

  it("2. JSON round-trip includes nested arrays", async () => {
    await savePreferenceProfile({
      analysis: sampleAnalysis,
      promptSection: "prompt",
      favoriteCount: 1,
      favoriteMaxId: 1,
      notForMeCount: 0,
      notForMeMaxId: 0,
      model: "test",
    });

    const latest = await getLatestPreferenceProfile();
    expect(latest?.analysis.themes).toEqual(["TypeScript", "Next.js"]);
    expect(latest?.analysis.scoringGuidance).toEqual(["Prioritize code examples"]);
  });

  it("3. corrupt analysis -> null + warn", async () => {
    // Insert corrupt json directly
    await dbMod.db.insert(schemaMod.preferenceProfiles).values({
      version: 1,
      analysis: "not valid json at all",
      promptSection: "corrupt",
      favoriteCount: 1,
      favoriteMaxId: 1,
      model: "model",
    });

    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const latest = await getLatestPreferenceProfile();
    expect(latest).toBeNull();
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("invalid JSON"));
    consoleSpy.mockRestore();
  });

  it("4. version mismatch -> null", async () => {
    await dbMod.db.insert(schemaMod.preferenceProfiles).values({
      version: 999,
      analysis: JSON.stringify(sampleAnalysis),
      promptSection: "mismatch",
      favoriteCount: 1,
      favoriteMaxId: 1,
      model: "model",
    });

    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const latest = await getLatestPreferenceProfile();
    expect(latest).toBeNull();
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("version mismatch"));
    consoleSpy.mockRestore();
  });

  it("5. empty table -> null", async () => {
    const latest = await getLatestPreferenceProfile();
    expect(latest).toBeNull();
  });

  it("6. getFavoriteStats returns correct count and maxId", async () => {
    // Empty stats first
    const emptyStats = await getFavoriteStats();
    expect(emptyStats).toEqual({ count: 0, maxId: 0 });

    // Insert articles
    await dbMod.upsertArticle({
      title: "Art 1",
      description: null,
      url: "https://example.com/art1",
      urlToImage: null,
      publishedAt: "2026-01-01T00:00:00Z",
      sourceName: "Zenn",
      sourceId: "zenn",
      author: null,
      keyword: "tech",
      summary: null,
      relevance: 9,
      usefulness: 9,
      recency: 9,
      reason: null,
      scoredAt: "2026-01-01T00:00:00Z",
      score: 9,
      embedding: null,
    });
    await dbMod.upsertArticle({
      title: "Art 2",
      description: null,
      url: "https://example.com/art2",
      urlToImage: null,
      publishedAt: "2026-01-01T00:00:00Z",
      sourceName: "Zenn",
      sourceId: "zenn",
      author: null,
      keyword: "tech",
      summary: null,
      relevance: 9,
      usefulness: 9,
      recency: 9,
      reason: null,
      scoredAt: "2026-01-01T00:00:00Z",
      score: 9,
      embedding: null,
    });

    const articlesList = await dbMod.db.select().from(schemaMod.articles);
    expect(articlesList.length).toBe(2);

    // Insert favorites
    await dbMod.db.insert(schemaMod.favorites).values({ articleId: articlesList[0].id });
    await dbMod.db.insert(schemaMod.favorites).values({ articleId: articlesList[1].id });

    const stats = await getFavoriteStats();
    expect(stats.count).toBe(2);
    expect(stats.maxId).toBeGreaterThan(0);
  });
});
