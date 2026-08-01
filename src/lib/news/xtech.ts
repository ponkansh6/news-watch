import { fetchRssText } from "./base/rss-fetcher";
import { parseRdf, StandardRdfItem } from "./base/rdf-parser";

const FEED_URL = "https://xtech.nikkei.com/rss/xtech-it.rdf";

export type XtechItem = StandardRdfItem;

export function parseXtechRss(xml: string): XtechItem[] {
  return parseRdf(xml);
}

export async function searchXtech(limit = 20): Promise<XtechItem[]> {
  const xml = await fetchRssText(FEED_URL, "xtech", {
    headers: { "User-Agent": "news-watch/1.0 (+https://github.com/shunki/news-watch)" },
  });
  if (!xml) return [];
  return parseXtechRss(xml).slice(0, limit);
}
