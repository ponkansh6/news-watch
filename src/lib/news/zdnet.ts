import { fetchRssText } from "./base/rss-fetcher";
import { parseRdf, StandardRdfItem } from "./base/rdf-parser";

const FEED_URL = "https://feeds.japan.zdnet.com/rss/zdnet/all.rdf";

export type ZdnetItem = StandardRdfItem;

export function parseZdnetRss(xml: string): ZdnetItem[] {
  return parseRdf(xml);
}

export async function searchZdnet(limit = 50): Promise<ZdnetItem[]> {
  const xml = await fetchRssText(FEED_URL, "zdnet", {
    headers: { "User-Agent": "news-watch/1.0 (+https://github.com/shunki/news-watch)" },
  });
  if (!xml) return [];
  return parseZdnetRss(xml).slice(0, limit);
}
