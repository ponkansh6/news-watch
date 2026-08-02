import type { NormalizedArticle } from "@/lib/types";
import { searchZenn, type ZennArticle } from "./zenn";
import { searchQiita, type QiitaFeedItem } from "./qiita";
import { searchYamadashy, type YamadashyItem } from "./yamadashy";
import { searchITmedia, type ItmediaItem } from "./itmedia";
import { searchCodeZine, type CodeZineItem } from "./codezine";
import { searchZdnet, type ZdnetItem } from "./zdnet";
import { searchXtech, type XtechItem } from "./xtech";
import { searchCloudWatch, type CloudWatchItem } from "./cloudwatch";
import { searchHatena, type HatenaItem } from "./hatena";

export interface SourceAdapter<T> {
  id: string;
  name: string;
  displayName: string;
  fetch: (limit: number) => Promise<T[]>;
  toArticle: (item: T, sourceId: string) => NormalizedArticle;
}

/** normalize() の元の description ルール（description優先、なければcontent、
 * どちらも無ければnull）を再現。既存フィクスチャとのバイト単位の互換性を保証する。 */
export function extractDescription(article: unknown): string | null {
  if (article && typeof article === "object") {
    const a = article as Record<string, unknown>;
    if ("description" in article) return (a.description as string | undefined) ?? null;
    if ("content" in article) return (a.content as string | undefined) ?? null;
  }
  return null;
}

export const SOURCE_REGISTRY = {
  zenn: {
    id: "zenn",
    name: "Zenn",
    displayName: "Zenn",
    fetch: searchZenn,
    toArticle: (z: ZennArticle, sourceId): NormalizedArticle => ({
      title: z.title,
      description: extractDescription(z),
      url: `https://zenn.dev${z.path}`,
      urlToImage: null,
      publishedAt: z.published_at ?? new Date().toISOString(),
      sourceName: "Zenn",
      sourceId,
      author: z.user?.name ?? z.user?.username ?? null,
    }),
  },
  qiita: {
    id: "qiita",
    name: "Qiita",
    displayName: "Qiita",
    fetch: searchQiita,
    toArticle: (q: QiitaFeedItem, sourceId): NormalizedArticle => ({
      title: q.title,
      description: extractDescription(q),
      url: typeof q.link === "string" ? q.link : q.link["@_href"],
      urlToImage: null,
      publishedAt: q.published ?? new Date().toISOString(),
      sourceName: "Qiita",
      sourceId,
      author: q.author?.name ?? null,
    }),
  },
  yamadashy: {
    id: "yamadashy",
    name: "Tech Blog",
    displayName: "Tech Blog",
    fetch: searchYamadashy,
    toArticle: (yd: YamadashyItem, sourceId): NormalizedArticle => ({
      title: yd.title,
      description: extractDescription(yd),
      url: yd.link ?? "",
      urlToImage: null,
      publishedAt: yd.pubDate ?? new Date().toISOString(),
      sourceName: "Tech Blog",
      sourceId,
      author: yd.author ?? null,
    }),
  },
  itmedia: {
    id: "itmedia",
    name: "@IT",
    displayName: "@IT",
    fetch: searchITmedia,
    toArticle: (it: ItmediaItem, sourceId): NormalizedArticle => ({
      title: it.title,
      description: extractDescription(it),
      url: it.link,
      urlToImage: null,
      publishedAt: it.pubDate ?? new Date().toISOString(),
      sourceName: "@IT",
      sourceId,
      author: null,
    }),
  },
  codezine: {
    id: "codezine",
    name: "CodeZine",
    displayName: "CodeZine",
    fetch: searchCodeZine,
    toArticle: (cz: CodeZineItem, sourceId): NormalizedArticle => ({
      title: cz.title,
      description: extractDescription(cz),
      url: cz.link,
      urlToImage: null,
      publishedAt: cz.pubDate ?? new Date().toISOString(),
      sourceName: "CodeZine",
      sourceId,
      author: null,
    }),
  },
  zdnet: {
    id: "zdnet",
    name: "ZDNet Japan",
    displayName: "ZDNet Japan",
    fetch: searchZdnet,
    toArticle: (z: ZdnetItem, sourceId): NormalizedArticle => ({
      title: z.title,
      description: extractDescription(z),
      url: z.link,
      urlToImage: null,
      publishedAt: z.date ?? new Date().toISOString(),
      sourceName: "ZDNet Japan",
      sourceId,
      author: z.creator ?? null,
    }),
  },
  xtech: {
    id: "xtech",
    name: "日経クロステック",
    displayName: "日経クロステック",
    fetch: searchXtech,
    toArticle: (x: XtechItem, sourceId): NormalizedArticle => ({
      title: x.title,
      description: extractDescription(x),
      url: x.link,
      urlToImage: null,
      publishedAt: x.date ?? new Date().toISOString(),
      sourceName: "日経クロステック",
      sourceId,
      author: x.creator ?? null,
    }),
  },
  cloudwatch: {
    id: "cloudwatch",
    name: "クラウド Watch",
    displayName: "クラウド Watch",
    fetch: searchCloudWatch,
    toArticle: (cw: CloudWatchItem, sourceId): NormalizedArticle => ({
      title: cw.title,
      description: extractDescription(cw),
      url: cw.link,
      urlToImage: null,
      publishedAt: cw.date ?? new Date().toISOString(),
      sourceName: "クラウド Watch",
      sourceId,
      author: cw.creator ?? null,
    }),
  },
  hatena: {
    id: "hatena",
    name: "Hatena Blog",
    displayName: "Hatena Blog",
    fetch: searchHatena,
    toArticle: (h: HatenaItem, sourceId): NormalizedArticle => ({
      title: h.title,
      description: extractDescription(h),
      url: h.link,
      urlToImage: null,
      publishedAt: h.pubDate ?? new Date().toISOString(),
      sourceName: "Hatena Blog",
      sourceId,
      author: h.author ?? null,
    }),
  },
} satisfies Record<string, SourceAdapter<any>>;

export type SourceId = keyof typeof SOURCE_REGISTRY;
export const SOURCE_IDS = Object.keys(SOURCE_REGISTRY) as SourceId[];
export const SOURCE_ID_TUPLE = SOURCE_IDS as [SourceId, ...SourceId[]];

export function getSourceAdapter(sourceId: string): SourceAdapter<any> | undefined {
  return (SOURCE_REGISTRY as Record<string, SourceAdapter<any>>)[sourceId];
}

/** normalize() の元の default: ダックタイピング分岐を再現。未知sourceIdを
 * 直接テストする2ファイルのために維持。 */
export function normalizeUnknownSource(article: unknown, sourceId: string): NormalizedArticle {
  const a = article as Record<string, any>;
  return {
    title: a.title,
    description: extractDescription(article),
    url: a.url ?? a.link ?? "",
    urlToImage: null,
    publishedAt: a.publishedAt ?? a.published ?? a.pubDate ?? a.date ?? new Date().toISOString(),
    sourceName: a.source?.name ?? null,
    sourceId,
    author: a.author ?? a.creator ?? null,
  };
}
