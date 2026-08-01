import { XMLParser } from "fast-xml-parser";
import { HATENA_TIMEOUT_MS } from "../constants";
import { fetchRssText } from "./base/rss-fetcher";
import { decodeEntities } from "./base/entity-decoder";

const HATENA_HOTENTRY_RSS_URL = "https://b.hatena.ne.jp/hotentry/it.rss";
const HATENA_ENTRYLIST_RSS_URL = "https://b.hatena.ne.jp/entrylist/it.rss";

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
  return itemList.map((i: Record<string, unknown>) => ({
    title: decodeEntities(i.title),
    link: String(i.link ?? i["@_rdf:about"]),
    description: decodeEntities(i.description),
    pubDate: typeof i.pubDate === "string" ? i.pubDate : undefined,
    author:
      typeof i["dc:creator"] === "string"
        ? i["dc:creator"]
        : typeof i.author === "string"
          ? i.author
          : undefined,
    guid: typeof i.guid === "string" ? i.guid : String(i.link ?? ""),
    category: i.category as string | string[] | undefined,
  }));
}

export async function searchHatena(limit = 50): Promise<HatenaItem[]> {
  const rssUrls = [HATENA_HOTENTRY_RSS_URL, HATENA_ENTRYLIST_RSS_URL];
  const results = await Promise.all(
    rssUrls.map(async (url) => {
      const xml = await fetchRssText(url, "hatena", {
        timeoutMs: HATENA_TIMEOUT_MS,
        headers: { "User-Agent": "news-watch/1.0 (+https://github.com/shunki/news-watch)" },
      });
      if (!xml) return [] as HatenaItem[];
      return parseHatenaRss(xml);
    }),
  );
  return results.flat().slice(0, limit);
}
