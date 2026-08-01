/**
 * Server Actions wrapper delegating to repository and query layers.
 */
import {
  upsertArticle,
  deleteOrphanedArticles,
  deleteLowScoredArticles,
  refreshRecencyForSources,
  type ArticleInsert,
} from "./repository/article-repository";

import {
  getScoredArticles,
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
} from "./repository/favorite-repository";

export type { ArticleInsert, TableName, TablePageOptions };

export {
  upsertArticle,
  deleteOrphanedArticles,
  deleteLowScoredArticles,
  refreshRecencyForSources,
  getScoredArticles,
  getAllArticles,
  getTablePage,
  getTableCounts,
  toggleFavorite,
  getFavoriteIds,
  getFavoriteArticles,
};
