import type { GNewsArticle } from "@/lib/news/gnews";
import type { NewsApiArticle } from "@/lib/news/newsapi";
import type { HackerNewsArticle } from "@/lib/news/hackernews";
import type { QiitaArticle } from "@/lib/news/qiita";
import type { GitHubRepo } from "@/lib/news/github";
import type { YamadashyItem } from "@/lib/news/yamadashy";

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
  GNewsArticle,
  NewsApiArticle,
  HackerNewsArticle,
  QiitaArticle,
  GitHubRepo,
  YamadashyItem,
};
