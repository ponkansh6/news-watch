import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "./schema";

// Repository & Query layer exports
import {
  upsertArticle,
  upsertArticles,
  deleteLowScoredArticles,
  refreshRecencyForSources,
  type ArticleInsert,
} from "./repository/article-repository";

import {
  getScoredArticles,
  getScoredArticlesCached,
  getAllArticles,
  getTablePage,
  getTableCounts,
  type TableName,
  type TablePageOptions,
} from "./query/article-queries";

import {
  toggleFavorite,
  getFavoriteIds,
  getFavoriteArticles,
  getFavoriteArticlesCached,
  getFavoriteStats,
} from "./repository/favorite-repository";

import {
  toggleNotForMe,
  getNotForMeArticles,
  getNotForMeStats,
} from "./repository/not-for-me-repository";

import {
  savePreferenceProfile,
  type SavePreferenceProfileInput,
} from "./repository/preference-repository";

import {
  getLatestPreferenceProfile,
  getLatestPreferenceProfileCached,
  type PreferenceProfile,
} from "./query/preference-queries";

const client = createClient({
  url: process.env.TURSO_DATABASE_URL ?? ":memory:",
  authToken: process.env.TURSO_AUTH_TOKEN,
});

export const db = drizzle({ client, schema });

// Re-export all public APIs
export type {
  ArticleInsert,
  TableName,
  TablePageOptions,
  SavePreferenceProfileInput,
  PreferenceProfile,
};
export {
  upsertArticle,
  upsertArticles,
  deleteLowScoredArticles,
  refreshRecencyForSources,
  getScoredArticles,
  getScoredArticlesCached,
  getAllArticles,
  getTablePage,
  getTableCounts,
  toggleFavorite,
  getFavoriteIds,
  getFavoriteArticles,
  getFavoriteArticlesCached,
  getFavoriteStats,
  toggleNotForMe,
  getNotForMeArticles,
  getNotForMeStats,
  savePreferenceProfile,
  getLatestPreferenceProfile,
  getLatestPreferenceProfileCached,
};
