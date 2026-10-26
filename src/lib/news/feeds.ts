import { fetchRssText } from "./base/rss-fetcher";
import { parseRdf, type StandardRdfItem } from "./base/rdf-parser";
import { parseRss2 } from "./base/rss2-parser";

export const NEWS_USER_AGENT = "news-watch/1.0 (+https://github.com/shunki/news-watch)";

type FeedFetchOptions = NonNullable<Parameters<typeof fetchRssText>[2]>;

/** Fetch and parse one feed without imposing source-specific limits or error handling. */
export async function fetchAndParseFeed<T>(
  url: string,
  sourceName: string,
  parse: (xml: string) => T[],
  options?: FeedFetchOptions,
): Promise<T[]> {
  const xml = await fetchRssText(url, sourceName, options);
  return xml ? parse(xml) : [];
}

function applyLimit<T>(items: T[], limit?: number): T[] {
  return limit === undefined ? items : items.slice(0, limit);
}

interface RdfFeedConfig {
  url: string;
}

export const RDF_FEEDS = {
  zdnet: { url: "https://feeds.japan.zdnet.com/rss/zdnet/all.rdf" },
  xtech: { url: "https://xtech.nikkei.com/rss/xtech-it.rdf" },
  cloudwatch: { url: "https://cloud.watch.impress.co.jp/data/rss/1.0/clw/feed.rdf" },
} as const satisfies Record<string, RdfFeedConfig>;

export function createRdfSource(sourceName: string, cfg: RdfFeedConfig) {
  return async function search(limit?: number): Promise<StandardRdfItem[]> {
    const items = await fetchAndParseFeed(cfg.url, sourceName, parseRdf, {
      headers: { "User-Agent": NEWS_USER_AGENT },
    });
    return applyLimit(items, limit);
  };
}

interface Rss2FeedConfig {
  url: string;
}

export const RSS2_FEEDS = {
  itmedia: { url: "https://rss.itmedia.co.jp/rss/0.91/ait.xml" },
  codezine: { url: "https://codezine.jp/rss/new/20/index.xml" },
  yamadashy: { url: "https://yamadashy.github.io/tech-blog-rss-feed/feeds/rss.xml" },
} as const satisfies Record<string, Rss2FeedConfig>;

export function createRss2Source<T>(sourceName: string, cfg: Rss2FeedConfig) {
  return async function search(limit?: number): Promise<T[]> {
    const items = await fetchAndParseFeed(cfg.url, sourceName, parseRss2<T>);
    return applyLimit(items, limit);
  };
}
