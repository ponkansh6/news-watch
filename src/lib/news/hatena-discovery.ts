import { db } from "@/lib/db";
import { hatenaFeeds } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export const HATENA_HOTENTRY_RSS_URL = "https://b.hatena.ne.jp/hotentry/it.rss";
export const HATENA_ENTRYLIST_RSS_URL = "https://b.hatena.ne.jp/entrylist/it.rss";
const REQUEST_DELAY_MS = 1000; // polite delay between requests
const MAX_RETRIES = 3;
const MAX_ERROR_COUNT = 5; // auto-disable after 5 consecutive errors
const HATENA_PROXY_URL = process.env.HATENA_PROXY_URL;

import { XMLParser } from "fast-xml-parser";

let proxyDispatcher: any = undefined;
try {
  if (HATENA_PROXY_URL) {
    try {
      require.resolve("undici");
      // @ts-ignore
      const { ProxyAgent } = require("undici");
      proxyDispatcher = new ProxyAgent(HATENA_PROXY_URL);
    } catch {
      // undici not found, ignore
    }
  }
} catch (e) {
  console.warn("[hatena-discovery] Failed to load ProxyAgent, falling back to direct fetch", e);
}

// Rate-limit guard: track last request time per process (Vercel cold starts reset this)
let lastRequestAt = 0;

export async function politeFetch(url: string, init?: RequestInit): Promise<Response> {
  const now = Date.now();
  const wait = Math.max(0, REQUEST_DELAY_MS - (now - lastRequestAt));
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastRequestAt = Date.now();

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);

  const dispatcher = proxyDispatcher;

  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        "User-Agent": "news-watch/1.0 (+https://github.com/shunki/news-watch)",
        Accept: "application/json",
        ...init?.headers,
      },
      // @ts-expect-error: dispatcher is a Node-specific fetch extension
      dispatcher,
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchWithRetry(url: string, retries = MAX_RETRIES): Promise<Response | null> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await politeFetch(url);
      if (res.status === 429) {
        const retryAfter = res.headers.get("Retry-After");
        const waitMs = retryAfter ? parseInt(retryAfter, 10) * 1000 : 60_000;
        console.warn(`[hatena-discovery] Rate limited (429), waiting ${waitMs}ms`);
        await new Promise((r) => setTimeout(r, waitMs));
        continue;
      }
      if (res.ok) return res;
      if (res.status >= 500 && attempt < retries) {
        await new Promise((r) => setTimeout(r, 2000 * 2 ** attempt));
        continue;
      }
      console.warn(`[hatena-discovery] HTTP ${res.status} for ${url}`);
      return res;
    } catch (err) {
      if (attempt === retries) throw err;
      await new Promise((r) => setTimeout(r, 2000 * 2 ** attempt));
    }
  }
  return null;
}

function extractArticlesFromHatenaRss(xml: string): { url: string; domain: string }[] {
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_" });
  const parsed = parser.parse(xml);
  const items = parsed?.["rdf:RDF"]?.item ?? parsed?.rss?.channel?.item ?? [];
  const itemList = Array.isArray(items) ? items : [items];

  const results: { url: string; domain: string }[] = [];
  for (const item of itemList) {
    const link = item.link ?? item["@_rdf:about"];
    if (typeof link === "string") {
      try {
        const url = new URL(link);
        results.push({ url: link, domain: url.hostname });
      } catch {
        // ignore invalid URLs
      }
    }
  }
  return results;
}

async function upsertFeed(domain: string, feedUrl: string, bookmarkCount: number) {
  await db
    .insert(hatenaFeeds)
    .values({
      domain,
      feedUrl,
      status: "active",
      bookmarkCount,
      discoveredAt: new Date().toISOString(),
    })
    .onConflictDoUpdate({
      target: hatenaFeeds.domain,
      set: {
        feedUrl,
        // Caller resolves bookmarkCount to MAX(existing, new) — libsql's
        // in-memory build lacks the SQL GREATEST() scalar function.
        bookmarkCount,
        status: "active", // reactivate if previously inactive/error
        errorCount: 0,
        lastError: null,
        updatedAt: new Date().toISOString(),
      },
    });
}

export async function discoverHatenaFeeds(): Promise<{
  discovered: number;
  updated: number;
  errors: string[];
}> {
  const errors: string[] = [];
  let discovered = 0;
  let updated = 0;

  const allDomains = new Set<string>();
  const rssUrls = [HATENA_HOTENTRY_RSS_URL, HATENA_ENTRYLIST_RSS_URL];

  for (const url of rssUrls) {
    const res = await fetchWithRetry(url);
    if (!res?.ok) {
      errors.push(`RSS ${url}: HTTP ${res?.status ?? "network error"}`);
      continue;
    }

    const xml = await res.text();
    const articles = extractArticlesFromHatenaRss(xml);

    for (const article of articles) {
      allDomains.add(article.domain);
    }
  }

  for (const domain of allDomains) {
    const feedUrl = `https://${domain}/rss`;

    // Check if existing to count as discovered vs updated
    const existing = await db
      .select({ id: hatenaFeeds.id, bookmarkCount: hatenaFeeds.bookmarkCount })
      .from(hatenaFeeds)
      .where(eq(hatenaFeeds.domain, domain))
      .limit(1);

    await upsertFeed(domain, feedUrl, 0);
    if (existing.length) updated++;
    else discovered++;
  }

  return { discovered, updated, errors };
}

/**
 * Mark a feed as errored (called by searchHatena on fetch failure).
 * Auto-disables after MAX_ERROR_COUNT consecutive failures.
 */
export async function recordFeedError(domain: string, error: string) {
  const feed = await db.select().from(hatenaFeeds).where(eq(hatenaFeeds.domain, domain)).limit(1);

  if (!feed.length) return;

  const newErrorCount = feed[0].errorCount + 1;
  const newStatus = newErrorCount >= MAX_ERROR_COUNT ? "error" : feed[0].status;

  await db
    .update(hatenaFeeds)
    .set({
      errorCount: newErrorCount,
      lastError: error,
      status: newStatus,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(hatenaFeeds.domain, domain));
}

/**
 * Mark a feed as successfully fetched (reset error count, update timestamp).
 */
export async function recordFeedSuccess(domain: string) {
  await db
    .update(hatenaFeeds)
    .set({
      lastFetchedAt: new Date().toISOString(),
      errorCount: 0,
      lastError: null,
      status: "active",
      updatedAt: new Date().toISOString(),
    })
    .where(eq(hatenaFeeds.domain, domain));
}

/**
 * Get all active feed URLs for searchHatena to consume.
 */
export async function getActiveFeedUrls(): Promise<string[]> {
  const rows = await db
    .select({ feedUrl: hatenaFeeds.feedUrl })
    .from(hatenaFeeds)
    .where(eq(hatenaFeeds.status, "active"));
  return rows.map((r) => r.feedUrl);
}
