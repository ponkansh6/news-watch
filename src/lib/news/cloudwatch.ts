import { fetchRssText } from "./base/rss-fetcher";
import { parseRdf, StandardRdfItem } from "./base/rdf-parser";

const FEED_URL = "https://cloud.watch.impress.co.jp/data/rss/1.0/clw/feed.rdf";

export type CloudWatchItem = StandardRdfItem;

export function parseCloudWatchRss(xml: string): CloudWatchItem[] {
  return parseRdf(xml);
}

export async function searchCloudWatch(limit = 20): Promise<CloudWatchItem[]> {
  const xml = await fetchRssText(FEED_URL, "cloudwatch", {
    headers: { "User-Agent": "news-watch/1.0 (+https://github.com/shunki/news-watch)" },
  });
  if (!xml) return [];
  return parseCloudWatchRss(xml).slice(0, limit);
}
