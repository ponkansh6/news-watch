import { XMLParser } from "fast-xml-parser";

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

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
});

export async function searchYamadashy(keyword: string): Promise<YamadashyItem[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);

  try {
    const res = await fetch(FEED_URL, { signal: controller.signal });
    if (!res.ok) {
      console.warn(`[yamadashy] HTTP ${res.status}`);
      return [];
    }

    const xml = await res.text();
    const parsed = parser.parse(xml);

    // RSS 2.0 structure: rss.channel.item (can be single item or array)
    const channel = parsed?.rss?.channel;
    if (!channel?.item) return [];

    const items: YamadashyItem[] = Array.isArray(channel.item)
      ? channel.item
      : [channel.item];

    // Filter by keyword match in title (case-insensitive)
    const kw = keyword.toLowerCase();
    return items.filter((item) => {
      const title = item.title ?? "";
      return title.toLowerCase().includes(kw);
    });
  } catch (err) {
    console.warn(`[yamadashy] fetch/parse error:`, err);
    return [];
  } finally {
    clearTimeout(timer);
  }
}