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
