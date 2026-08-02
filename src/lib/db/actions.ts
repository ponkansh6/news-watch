/**
 * Server Actions wrapper delegating to repository and query layers.
 */
import {
  upsertArticle,
  upsertArticles,
  deleteOrphanedArticles,
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
} from "./repository/favorite-repository";

export type { ArticleInsert, TableName, TablePageOptions };

export {
  upsertArticle,
  upsertArticles,
  deleteOrphanedArticles,
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
};
