import { db } from "@/lib/db";
import { hatenaFeeds } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

const HATENA_BOOKMARK_API = "https://b.hatena.ne.jp/entrylist/json";
const CATEGORY = "it"; // technology category
const MAX_PAGES = 3; // paginate through first 3 pages (each page ~30 entries)
const REQUEST_DELAY_MS = 1000; // polite delay between requests
const MAX_RETRIES = 3;
const MAX_ERROR_COUNT = 5; // auto-disable after 5 consecutive errors

// Rate-limit guard: track last request time per process (Vercel cold starts reset this)
let lastRequestAt = 0;

async function politeFetch(url: string, init?: RequestInit): Promise<Response> {
  const now = Date.now();
  const wait = Math.max(0, REQUEST_DELAY_MS - (now - lastRequestAt));
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastRequestAt = Date.now();

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        "User-Agent": "news-watch/1.0 (+https://github.com/shunki/news-watch)",
        Accept: "application/json",
        ...init?.headers,
      },
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

function extractHatenablogDomains(entries: any[]): Map<string, number> {
  // Returns Map<domain, maxBookmarkCount> — keep highest bookmark count per domain
  const map = new Map<string, number>();
  for (const entry of entries) {
    const url = entry?.link || entry?.url;
    if (!url) continue;
    try {
      const u = new URL(url);
      if (u.hostname.endsWith(".hatenablog.com") || u.hostname === "hatenablog.com") {
        const domain = u.hostname; // e.g. "user.hatenablog.com"
        const count = entry.count ?? entry.bookmark_count ?? 0;
        map.set(domain, Math.max(map.get(domain) ?? 0, count));
      }
    } catch {
      // ignore malformed URLs
    }
  }
  return map;
}

async function discoverFeedUrl(domain: string): Promise<string | null> {
  // Hatena Blog RSS is always at https://{domain}/rss
  // But we verify via HTML autodiscovery for robustness
  const homepage = `https://${domain}`;
  try {
    const res = await politeFetch(homepage, { headers: { Accept: "text/html" } });
    if (!res.ok) return `https://${domain}/rss`; // fallback to standard path
    const html = await res.text();
    // Parse <link rel="alternate" type="application/rss+xml" href="...">
    const match =
      html.match(
        /<link[^>]+rel=["']alternate["'][^>]+type=["']application\/rss\+xml["'][^>]+href=["']([^"']+)["']/i,
      ) ??
      html.match(
        /<link[^>]+href=["']([^"']+)["'][^>]+rel=["']alternate["'][^>]+type=["']application\/rss\+xml["']/i,
      );
    if (match?.[1]) return match[1];
    return `https://${domain}/rss`;
  } catch {
    return `https://${domain}/rss`;
  }
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

  // Fetch paginated entrylist
  for (let page = 1; page <= MAX_PAGES; page++) {
    const url = `${HATENA_BOOKMARK_API}?category=${CATEGORY}&page=${page}`;
    const res = await fetchWithRetry(url);
    if (!res?.ok) {
      errors.push(`Page ${page}: HTTP ${res?.status ?? "network error"}`);
      break;
    }

    let data: any;
    try {
      data = await res.json();
    } catch {
      errors.push(`Page ${page}: invalid JSON`);
      continue;
    }

    const entries = data?.entries ?? data ?? [];
    if (!entries.length) break; // no more pages

    const domains = extractHatenablogDomains(entries);
    for (const [domain, bookmarkCount] of domains) {
      const feedUrl = await discoverFeedUrl(domain);
      if (!feedUrl) {
        errors.push(`Failed to resolve feed for ${domain}`);
        continue;
      }

      // Check if existing to count as discovered vs updated, and resolve
      // bookmarkCount to the running maximum (libsql lacks SQL GREATEST()).
      const existing = await db
        .select({ id: hatenaFeeds.id, bookmarkCount: hatenaFeeds.bookmarkCount })
        .from(hatenaFeeds)
        .where(eq(hatenaFeeds.domain, domain))
        .limit(1);

      const resolvedCount = Math.max(existing[0]?.bookmarkCount ?? 0, bookmarkCount);
      await upsertFeed(domain, feedUrl, resolvedCount);
      if (existing.length) updated++;
      else discovered++;
    }
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
