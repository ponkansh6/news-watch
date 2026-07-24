import { XMLParser } from "fast-xml-parser";

const FEED_URL = "https://rss.itmedia.co.jp/rss/0.91/ait.xml";

export interface ItmediaItem {
  title: string;
  link: string;
  description?: string;
  pubDate?: string;
  guid?: string;
  category?: string | string[];
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
});

export async function searchITmedia(limit = 50): Promise<ItmediaItem[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);

  try {
    const res = await fetch(FEED_URL, { signal: controller.signal });
    if (!res.ok) {
      console.warn(`[itmedia] HTTP ${res.status}`);
      return [];
    }

    const xml = await res.text();
    const parsed = parser.parse(xml);

    // RSS 2.0 structure: rss.channel.item (can be single item or array)
    const channel = parsed?.rss?.channel;
    if (!channel?.item) return [];

    const items: ItmediaItem[] = Array.isArray(channel.item) ? channel.item : [channel.item];

    return items.slice(0, limit);
  } catch (err) {
    console.warn(`[itmedia] fetch/parse error:`, err);
    return [];
  } finally {
    clearTimeout(timer);
  }
}
