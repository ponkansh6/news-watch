import { XMLParser } from "fast-xml-parser";
import { HATENA_HOTENTRY_RSS_URL, HATENA_ENTRYLIST_RSS_URL } from "@/lib/news/hatena-discovery";
import { HATENA_TIMEOUT_MS } from "../constants";

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

export function decodeEntities(input: unknown): string {
  if (input == null) return "";
  const str =
    typeof input === "object"
      ? String((input as Record<string, unknown>)["#text"] ?? "")
      : String(input);
  if (!str) return "";
  return str
    .replace(/&#x([0-9a-fA-F]+);/g, (_: string, hex: string) =>
      String.fromCodePoint(parseInt(hex, 16)),
    )
    .replace(/&#(\d+);/g, (_: string, dec: string) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ");
}

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
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HATENA_TIMEOUT_MS);
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
