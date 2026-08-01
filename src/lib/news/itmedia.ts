import { fetchRssText } from "./base/rss-fetcher";
import { parseRss2 } from "./base/rss2-parser";

const FEED_URL = "https://rss.itmedia.co.jp/rss/0.91/ait.xml";

export interface ItmediaItem {
  title: string;
  link: string;
  description?: string;
  pubDate?: string;
  guid?: string;
  category?: string | string[];
}

export async function searchITmedia(limit = 50): Promise<ItmediaItem[]> {
  const xml = await fetchRssText(FEED_URL, "itmedia");
  if (!xml) return [];
  const items = parseRss2<ItmediaItem>(xml);
  return items.slice(0, limit);
}
