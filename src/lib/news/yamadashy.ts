import { fetchRssText } from "./base/rss-fetcher";
import { parseRss2 } from "./base/rss2-parser";

const FEED_URL = "https://yamadashy.github.io/tech-blog-rss-feed/feeds/rss.xml";

export interface YamadashyItem {
  title: string;
  link: string;
  description?: string;
  pubDate?: string;
  author?: string;
  guid?: string;
  category?: string | string[];
}

export async function searchYamadashy(limit = 50): Promise<YamadashyItem[]> {
  const xml = await fetchRssText(FEED_URL, "yamadashy");
  if (!xml) return [];
  const items = parseRss2<YamadashyItem>(xml);
  return items.slice(0, limit);
}
