import type { NewsApiArticle } from "@/lib/news/newsapi";
import type { QiitaFeedItem } from "@/lib/news/qiita";
import type { YamadashyItem } from "@/lib/news/yamadashy";
import type { HatenaItem } from "@/lib/news/hatena";

export interface NormalizedArticle {
  title: string;
  description: string | null;
  url: string;
  urlToImage: string | null;
  publishedAt: string;
  sourceName: string | null;
  sourceId: string;
  author: string | null;
}

export interface ArticleWithTag {
  article: NormalizedArticle;
  embedding: number[];
  keyword: string | null; // best-matching term (highest vector similarity), null if below threshold
  similarity: number; // cosine similarity to the best-matching term
}

export type ArticleInput = {
  title: string;
  description: string | null;
};

export type { NewsApiArticle, QiitaFeedItem as QiitaArticle, YamadashyItem, HatenaItem };
