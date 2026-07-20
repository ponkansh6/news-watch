import type { NewsApiArticle } from "@/lib/news/newsapi";
import type { QiitaFeedItem } from "@/lib/news/qiita";
import type { GitHubRepo } from "@/lib/news/github";
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

export type ArticleInput = {
  title: string;
  description: string | null;
};

export type {
  NewsApiArticle,
  QiitaFeedItem as QiitaArticle,
  GitHubRepo,
  YamadashyItem,
  HatenaItem,
};
