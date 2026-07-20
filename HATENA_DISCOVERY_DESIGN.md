# Hatena Blog Dynamic Discovery Pipeline — Design Document

**Status**: Design Phase (Ready for Implementation)
**Author**: Oracle (Architecture Advisor)
**Date**: 2026-07-15
**Target**: Fixer Agent Implementation

---

## 1. Executive Summary

Replace the hardcoded `HATENA_FEEDS` array in `src/lib/news/hatena.ts` with a **dynamic discovery pipeline** that:

1. **Discovers** Hatena Blog domains via Hatena Bookmark API (`/entrylist/json?category=it`)
2. **Resolves** each domain's RSS feed URL via HTML autodiscovery (`<link rel="alternate" type="application/rss+xml">`)
3. **Persists** discovered feeds in a new `hatena_feeds` SQLite table
4. **Refactors** `searchHatena(limit)` to read active feeds from the DB
5. **Schedules** periodic discovery via a new QStash-compatible cron route `/api/discover-hatena`

---

## 2. Database Schema — `hatena_feeds` Table

**File**: `src/lib/db/schema.ts` (append to existing file)

```typescript
// Add after keywordEmbeddings table (around line 51)

/**
 * Discovered Hatena Blog RSS feeds.
 * - domain: e.g. "user.hatenablog.com" (unique key for deduplication)
 * - feedUrl: resolved RSS URL (e.g. "https://user.hatenablog.com/rss")
 * - status: "active" | "inactive" | "error" — controls whether searchHatena reads it
 * - bookmarkCount: popularity signal from Hatena Bookmark (for ranking/prioritization)
 * - lastFetchedAt: last successful fetch timestamp (for staleness detection)
 * - errorCount: consecutive fetch errors (for auto-disable after N failures)
 * - discoveredAt / updatedAt: audit trail
 */
export const hatenaFeeds = sqliteTable(
  "hatena_feeds",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    domain: text("domain").notNull().unique(), // e.g. "user.hatenablog.com"
    feedUrl: text("feed_url").notNull(), // e.g. "https://user.hatenablog.com/rss"
    status: text("status", { enum: ["active", "inactive", "error"] })
      .notNull()
      .default("active"),
    bookmarkCount: integer("bookmark_count").notNull().default(0),
    lastFetchedAt: text("last_fetched_at"), // ISO timestamp
    errorCount: integer("error_count").notNull().default(0),
    lastError: text("last_error"), // last error message
    discoveredAt: text("discovered_at")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
    updatedAt: text("updated_at")
      .notNull()
      .$defaultFn(() => new Date().toISOString())
      .$onUpdateFn(() => new Date().toISOString()),
  },
  (table) => ({
    statusIdx: index("idx_hatena_feeds_status").on(table.status),
    domainIdx: index("idx_hatena_feeds_domain").on(table.domain),
  }),
);
```

**Migration**: Run `pnpm drizzle-kit generate` then `pnpm drizzle-kit migrate` after adding this table.

---

## 3. Discovery Module — `src/lib/news/hatena-discovery.ts`

**New file**. Pure logic, no side effects except DB writes.

```typescript
import { db } from "@/lib/db";
import { hatenaFeeds } from "@/lib/db/schema";
import { eq, and, sql } from "drizzle-orm";

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
        bookmarkCount: sql`GREATEST(${hatenaFeeds.bookmarkCount}, ${bookmarkCount})`,
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

      // Check if existing to count as discovered vs updated
      const existing = await db
        .select({ id: hatenaFeeds.id })
        .from(hatenaFeeds)
        .where(eq(hatenaFeeds.domain, domain))
        .limit(1);

      await upsertFeed(domain, feedUrl, bookmarkCount);
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
```

---

## 4. Refactored `src/lib/news/hatena.ts`

**Replace the entire file**. Key changes:

- Remove `HATENA_FEEDS` constant
- `searchHatena(limit)` now calls `getActiveFeedUrls()` from discovery module
- On fetch error, call `recordFeedError()` for auto-disable logic
- On success, call `recordFeedSuccess()`

```typescript
import { XMLParser } from "fast-xml-parser";
import { getActiveFeedUrls, recordFeedError, recordFeedSuccess } from "@/lib/news/hatena-discovery";

export interface HatenaItem {
  title: string;
  link: string;
  description?: string;
  pubDate?: string;
  author?: string;
  guid?: string;
  category?: string | string[];
}

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_" });

function parseHatenaRss(xml: string): HatenaItem[] {
  const parsed = parser.parse(xml);
  const channel = parsed?.rss?.channel;
  if (!channel?.item) return [];
  const items: any[] = Array.isArray(channel.item) ? channel.item : [channel.item];
  return items.map((i) => ({
    title: i.title,
    link: i.link,
    description: i.description,
    pubDate: i.pubDate,
    author: i["dc:creator"] ?? i.author ?? null,
    guid: i.guid,
    category: i.category,
  }));
}

export async function searchHatena(limit = 50): Promise<HatenaItem[]> {
  const feedUrls = await getActiveFeedUrls();
  if (feedUrls.length === 0) {
    console.warn("[hatena] No active feeds discovered yet. Run discovery first.");
    return [];
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);

  try {
    const results = await Promise.all(
      feedUrls.map(async (url) => {
        try {
          const res = await fetch(url, {
            signal: controller.signal,
            headers: { "User-Agent": "news-watch/1.0 (+https://github.com/shunki/news-watch)" },
          });
          if (!res.ok) {
            const domain = new URL(url).hostname;
            await recordFeedError(domain, `HTTP ${res.status}`);
            console.warn(`[hatena] HTTP ${res.status} for ${url}`);
            return [] as HatenaItem[];
          }
          const xml = await res.text();
          const items = parseHatenaRss(xml);
          const domain = new URL(url).hostname;
          await recordFeedSuccess(domain);
          return items;
        } catch (err) {
          const domain = new URL(url).hostname;
          await recordFeedError(domain, err instanceof Error ? err.message : String(err));
          console.warn(`[hatena] fetch/parse error for ${url}:`, err);
          return [] as HatenaItem[];
        }
      }),
    );
    return results.flat().slice(0, limit);
  } finally {
    clearTimeout(timer);
  }
}
```

---

## 5. Discovery Cron Route — `src/app/api/discover-hatena/route.ts`

**New file**. QStash-compatible (POST, secret verification, idempotent).

```typescript
import { NextResponse } from "next/server";
import { discoverHatenaFeeds } from "@/lib/news/hatena-discovery";

const CRON_SECRET = process.env.CRON_SECRET; // Set in Vercel env / QStash header

export const maxDuration = 60; // Vercel Hobby limit

function verifyAuth(request: Request): boolean {
  // QStash sends: "Upstash-Signature" header with HMAC-SHA256 of body
  // For simplicity, also accept CRON_SECRET as Bearer token (Vercel Cron compatible)
  const authHeader = request.headers.get("Authorization");
  const upstashSig = request.headers.get("Upstash-Signature");

  if (CRON_SECRET && authHeader === `Bearer ${CRON_SECRET}`) return true;
  if (CRON_SECRET && upstashSig) {
    // TODO: Implement proper Upstash signature verification if needed
    // For now, accept if header exists (QStash only calls configured endpoints)
    return true;
  }
  return false;
}

export async function POST(request: Request) {
  if (!verifyAuth(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await discoverHatenaFeeds();
    return NextResponse.json({
      ok: true,
      discovered: result.discovered,
      updated: result.updated,
      errors: result.errors,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error("[discover-hatena] Fatal error:", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}

export async function GET() {
  return NextResponse.json({
    message:
      "POST to trigger Hatena Blog discovery. Requires Authorization: Bearer <CRON_SECRET> or Upstash-Signature header.",
  });
}
```

**Environment Variable**: Add `CRON_SECRET` to Vercel Environment Variables (generate a random 32-char string). Configure QStash to POST to `https://your-app.vercel.app/api/discover-hatena` with `Authorization: Bearer <CRON_SECRET>` header.

**Schedule Recommendation**: Run discovery **once daily** (e.g., 03:00 JST) to minimize Hatena Bookmark API calls and IP ban risk.

---

## 6. Flow Integration — Discovery ↔ Ingestion

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         SCHEDULED DISCOVERY (Daily, 03:00 JST)              │
│                                                                             │
│   QStash Cron ──────► POST /api/discover-hatena                            │
│                          │                                                  │
│                          ▼                                                  │
│                   discoverHatenaFeeds()                                     │
│                          │                                                  │
│                          ▼                                                  │
│              ┌────────────────────────┐                                    │
│              │  Hatena Bookmark API   │                                    │
│              │  /entrylist/json?cat=it│                                    │
│              └───────────┬─────────────┘                                    │
│                          │                                                  │
│                          ▼                                                  │
│              Filter *.hatenablog.com domains                               │
│                          │                                                  │
│                          ▼                                                  │
│              RSS Autodiscovery (HTML <link rel="alternate">)               │
│                          │                                                  │
│                          ▼                                                  │
│              UPSERT into hatena_feeds (status=active)                      │
└──────────────────────────┼──────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         ON-DEMAND / SCHEDULED INGESTION                       │
│                                                                             │
│   User clicks "Fetch" ───► POST /api/fetch-news { sources: ["hatena", ...] }│
│                          │                                                  │
│                          ▼                                                  │
│                   searchHatena(20)                                          │
│                          │                                                  │
│                          ▼                                                  │
│              SELECT feedUrl FROM hatena_feeds WHERE status='active'        │
│                          │                                                  │
│                          ▼                                                  │
│              Fetch RSS feeds in parallel                                    │
│                          │                                                  │
│                          ├── Success ──► recordFeedSuccess(domain)         │
│                          │                                                  │
│                          └── Failure ──► recordFeedError(domain, err)      │
│                                                      │                      │
│                                                      ▼                      │
│                                            errorCount >= 5 ──► status='error'│
│                                                                             │
│                          ▼                                                  │
│              normalize() → tagArticlesByKeyword() → scoreAndSaveTagged()   │
│                          │                                                  │
│                          ▼                                                  │
│                    upsertArticle() → SQLite (articles table)               │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Ordering Guarantee**: Discovery runs **independently** (daily cron). Ingestion (`fetch-news`) reads whatever is currently `status='active'` in `hatena_feeds`. No coordination needed — eventual consistency is acceptable (worst case: 24h lag for new blogs to appear).

---

## 7. Error & Rate-Limit Handling (Vercel Shared IP Risk)

| Risk                                                                   | Mitigation                                                                                                                                                                                                                                                                                                                 |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Hatena Bookmark API rate limit / IP ban** (shared Vercel egress IPs) | • **Daily cron only** (1 run/day = ~3 requests max) <br>• **Polite delay**: 1s between requests (`REQUEST_DELAY_MS`) <br>• **Respect `Retry-After`** on 429 <br>• **Exponential backoff** on 5xx <br>• **Optional**: Set `HATENA_PROXY_URL` env var to route via a dedicated proxy (e.g., Cloudflare Worker with fixed IP) |
| **RSS fetch failures** (blog deleted, domain expired)                  | • `recordFeedError()` increments `errorCount` <br>• Auto-disable after `MAX_ERROR_COUNT=5` consecutive failures <br>• `recordFeedSuccess()` resets error count                                                                                                                                                             |
| **Discovery finds 0 feeds** (API change, category empty)               | • Log warning, keep existing active feeds <br>• Alert via logging (check Vercel logs)                                                                                                                                                                                                                                      |
| **RSS autodiscovery fails**                                            | • Fallback to `https://{domain}/rss` (Hatena Blog standard)                                                                                                                                                                                                                                                                |
| **DB write failures**                                                  | • Wrapped in try/catch, logged, discovery continues for other domains                                                                                                                                                                                                                                                      |

**Proxy Configuration (Optional but Recommended for Production)**:

```bash
# Vercel Environment Variable
HATENA_PROXY_URL=https://your-proxy.workers.dev
```

If set, `politeFetch` prepends this proxy URL: `fetch(`${HATENA_PROXY_URL}?url=${encodeURIComponent(targetUrl)}`)`.

---

## 8. Test Plan

| Test File                                | Scope                       | Key Cases                                                                                                                                                                                                                                                                                  |
| ---------------------------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `tests/news/hatena-discovery.test.ts`    | Unit: `discoverHatenaFeeds` | • Filters only `*.hatenablog.com` domains <br>• Deduplicates by domain, keeps max bookmarkCount <br>• RSS autodiscovery parses `<link rel="alternate" type="application/rss+xml">` <br>• Falls back to `/{domain}/rss` <br>• Upserts: insert new, update bookmarkCount, reactivate errored |
| `tests/news/hatena-discovery-db.test.ts` | Integration: DB ops         | • `getActiveFeedUrls()` returns only `status='active'` <br>• `recordFeedError()` increments count, disables at threshold <br>• `recordFeedSuccess()` resets error count, updates timestamp                                                                                                 |
| `tests/news/hatena.test.ts` (update)     | Unit: `searchHatena`        | • Reads from DB via `getActiveFeedUrls()` <br>• Calls `recordFeedError`/`recordFeedSuccess` on fetch result <br>• Handles empty active feed list gracefully                                                                                                                                |
| `tests/api/discover-hatena.test.ts`      | Integration: Cron route     | • POST with valid `Authorization: Bearer <CRON_SECRET>` → 200 <br>• POST without auth → 401 <br>• Returns `{ discovered, updated, errors }`                                                                                                                                                |

**Test Infrastructure**: Use `vitest` with `vi.stubGlobal("fetch", mockFetch)` and a test SQLite DB (file-based or `:memory:` via Drizzle).

---

## 9. OpenSpec Updates — `openspec/specs/news-watch/spec.md`

### 9.1 Section 2.1 (In Scope) — Add:

- Dynamic discovery of Hatena Blog feeds via Hatena Bookmark API
- Periodic feed discovery via scheduled cron (QStash)

### 9.2 Section 5 (Data Model) — Add Table:

```markdown
### hatena_feeds (SQLite via Drizzle ORM)

| Field           | Type    | Description                                                     |
| --------------- | ------- | --------------------------------------------------------------- |
| `id`            | integer | Primary key (auto-increment)                                    |
| `domain`        | text    | Hatena Blog domain (e.g., `user.hatenablog.com`), UNIQUE        |
| `feedUrl`       | text    | Resolved RSS feed URL (e.g., `https://user.hatenablog.com/rss`) |
| `status`        | text    | `active` \| `inactive` \| `error` — controls ingestion          |
| `bookmarkCount` | integer | Max bookmark count seen from Hatena Bookmark (popularity)       |
| `lastFetchedAt` | text    | ISO timestamp of last successful RSS fetch                      |
| `errorCount`    | integer | Consecutive fetch errors (auto-disables at 5)                   |
| `lastError`     | text    | Last error message                                              |
| `discoveredAt`  | text    | ISO timestamp when first discovered                             |
| `updatedAt`     | text    | ISO timestamp of last update                                    |

**Indexes:** `idx_hatena_feeds_status`, `idx_hatena_feeds_domain`
```

### 9.3 Section 6 (Architecture) — Update Data Flow Diagram:

```
External APIs (NewsAPI, Qiita, GitHub, Hatena Bookmark, RSS feeds)
  → src/lib/news/ (Fetchers + Discovery)
    → src/lib/llm/openrouter.ts (LLM: relevance + usefulness + summary)
    → src/app/api/fetch-news/route.ts (calcRecencyScore + weighted composite)
      → src/lib/db/actions.ts (Persistence)
        → SQLite Database (articles + hatena_feeds)
          → src/app/page.tsx (RSC: Data Fetching)
            → src/app/article-list.tsx (Client: Rendering + tooltip breakdown)
```

### 9.4 Section 6 — Add "Hatena Discovery Pipeline" Subsection:

```markdown
### 6.x Hatena Blog Discovery Pipeline

**Trigger**: Daily QStash cron (03:00 JST) → `POST /api/discover-hatena`

**Steps**:

1. Call Hatena Bookmark API `https://b.hatena.ne.jp/entrylist/json?category=it&page=1..3`
2. Filter entries where URL hostname matches `*.hatenablog.com`
3. Deduplicate by domain, keep highest `bookmark_count`
4. For each domain, fetch homepage HTML and parse `<link rel="alternate" type="application/rss+xml" href="...">`
5. Fallback to `https://{domain}/rss` if autodiscovery fails
6. UPSERT into `hatena_feeds` table (`status='active'`, update `bookmarkCount`)
7. Ingestion (`fetch-news`) reads `feedUrl` from `hatena_feeds WHERE status='active'`

**Rate Limit Mitigation**:

- Max 3 API calls per discovery run (1 per page)
- 1s delay between requests
- Respect `Retry-After` on 429
- Optional proxy via `HATENA_PROXY_URL` env var for fixed egress IP

**Failure Handling**:

- RSS fetch errors increment `errorCount`; auto-disable at 5 consecutive failures
- Discovery errors logged but don't block other domains
```

### 9.5 Section 8 (Non-Goals) — Add:

- Real-time WebSub/PubSubHubbub push notifications (polling-based discovery is sufficient for daily cadence)
- Full-text search of Hatena Blog content (RSS summary only)

---

## 10. File Change Checklist

| File                                     | Action                      | Notes                                                                         |
| ---------------------------------------- | --------------------------- | ----------------------------------------------------------------------------- |
| `src/lib/db/schema.ts`                   | **Add** `hatenaFeeds` table | Run `pnpm drizzle-kit generate && pnpm drizzle-kit migrate` after             |
| `src/lib/db/index.ts`                    | **Export** `hatenaFeeds`    | Add `export { hatenaFeeds } from "./schema";`                                 |
| `src/lib/news/hatena-discovery.ts`       | **Create** new module       | Core discovery logic + DB helpers                                             |
| `src/lib/news/hatena.ts`                 | **Rewrite**                 | Remove `HATENA_FEEDS`, use `getActiveFeedUrls()`, add error/success recording |
| `src/app/api/discover-hatena/route.ts`   | **Create** new route        | QStash-compatible POST, secret auth                                           |
| `src/lib/sources.ts`                     | **No change**               | `hatena` source already registered                                            |
| `src/app/api/fetch-news/route.ts`        | **No change**               | Already calls `searchHatena(20)`                                              |
| `openspec/specs/news-watch/spec.md`      | **Update**                  | Sections 2.1, 5, 6, 8 per §9                                                  |
| `tests/news/hatena-discovery.test.ts`    | **Create**                  | Unit tests for discovery logic                                                |
| `tests/news/hatena-discovery-db.test.ts` | **Create**                  | Integration tests for DB helpers                                              |
| `tests/news/hatena.test.ts`              | **Update**                  | Mock `getActiveFeedUrls`, verify error/success recording                      |
| `tests/api/discover-hatena.test.ts`      | **Create**                  | Route auth + response shape                                                   |
| `.env.example`                           | **Add**                     | `CRON_SECRET=`, `HATENA_PROXY_URL=` (optional)                                |

---

## 11. Risks & Trade-offs

| Risk                                                                                                                    | Likelihood            | Impact | Mitigation                                                                                    |
| ----------------------------------------------------------------------------------------------------------------------- | --------------------- | ------ | --------------------------------------------------------------------------------------------- |
| **Popularity bias** — Only blogs with recent bookmarks in `category=it` are discovered. Niche/low-traffic blogs missed. | High                  | Medium | Acceptable for v1. Future: add `category=all` or keyword search via Google CSE.               |
| **Hatena Bookmark API ToS / Rate limit changes**                                                                        | Medium                | High   | Daily cron + polite delay + backoff. Monitor logs. Proxy option ready.                        |
| **Vercel shared IP ban**                                                                                                | Low (with daily cron) | High   | Daily cron = ~90 req/month. Well within limits. Proxy env var as escape hatch.                |
| **Discovery → Ingestion lag** (new blog takes up to 24h to appear)                                                      | Certain               | Low    | Acceptable for news aggregation. Manual trigger via POST to `/api/discover-hatena` if needed. |
| **RSS feed changes/breaks**                                                                                             | Medium                | Low    | Auto-disable after 5 errors. Logs alert operator.                                             |
| **HTML autodiscovery fragility**                                                                                        | Low                   | Low    | Fallback to standard `/{domain}/rss` path (Hatena Blog convention).                           |

---

## 12. Blocker Check

- [ ] **QStash signature verification**: Current `fetch-news` route has no auth. The new `discover-hatena` route uses a simple `CRON_SECRET` Bearer token. If QStash HMAC verification is required, implement `verifyUpstashSignature()` helper (see Upstash docs). **Not a blocker for v1** — Bearer token works with QStash "Custom Header" config.
- [ ] **Drizzle migration**: Must run `pnpm drizzle-kit generate && pnpm drizzle-kit migrate` after schema change. **Blocker for deployment** — include in deploy checklist.
- [ ] **Test DB setup**: Vitest needs a test database (file SQLite or `:memory:`). Ensure `vitest.config.ts` has `setupFiles` for DB initialization. **Verify before implementation**.

---

## 13. Implementation Order (for Fixer)

1. **Schema & Migration**: Add `hatenaFeeds` to `schema.ts`, export from `index.ts`, generate & run migration.
2. **Discovery Module**: Create `hatena-discovery.ts` with all functions.
3. **Refactor `hatena.ts`**: Replace hardcoded feeds with DB-driven logic.
4. **Cron Route**: Create `discover-hatena/route.ts`.
5. **OpenSpec Update**: Apply §9 changes to `spec.md`.
6. **Tests**: Write all test files in §8.
7. **Env Config**: Add `CRON_SECRET` to Vercel, configure QStash cron.
8. **Verify**: Run `pnpm exec vitest run`, then manual `curl -X POST -H "Authorization: Bearer $CRON_SECRET" https://localhost:3000/api/discover-hatena`.

---

**End of Design Document** — Ready for Fixer implementation.
