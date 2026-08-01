import { fetchRssText } from "./base/rss-fetcher";
import { parseRss2 } from "./base/rss2-parser";

const FEED_URL = "https://codezine.jp/rss/new/20/index.xml";

export interface CodeZineItem {
  title: string;
  link: string;
  description?: string;
  pubDate?: string;
  guid?: string;
}

export async function searchCodeZine(limit = 50): Promise<CodeZineItem[]> {
  const xml = await fetchRssText(FEED_URL, "codezine");
  if (!xml) return [];
  const items = parseRss2<CodeZineItem>(xml);
  return items.slice(0, limit);
}
