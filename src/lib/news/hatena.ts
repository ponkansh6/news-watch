import { XMLParser } from "fast-xml-parser";
import { HATENA_HOTENTRY_RSS_URL, HATENA_ENTRYLIST_RSS_URL } from "@/lib/news/hatena-discovery";

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
  const items = parsed?.["rdf:RDF"]?.item ?? parsed?.rss?.channel?.item ?? [];
  const itemList = Array.isArray(items) ? items : [items];
  return itemList.map((i: any) => ({
    title: i.title,
    link: i.link ?? i["@_rdf:about"],
    description: i.description,
    pubDate: i.pubDate,
    author: i["dc:creator"] ?? i.author ?? null,
    guid: i.guid ?? i.link,
    category: i.category,
  }));
}

export async function searchHatena(limit = 50): Promise<HatenaItem[]> {
  const rssUrls = [HATENA_HOTENTRY_RSS_URL, HATENA_ENTRYLIST_RSS_URL];
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const results = await Promise.all(
      rssUrls.map(async (url) => {
        try {
          const res = await fetch(url, {
            signal: controller.signal,
            headers: { "User-Agent": "news-watch/1.0 (+https://github.com/shunki/news-watch)" },
          });
          if (!res.ok) {
            console.warn(`[hatena] HTTP ${res.status} for ${url}`);
            return [] as HatenaItem[];
          }
          const xml = await res.text();
          return parseHatenaRss(xml);
        } catch (err) {
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
