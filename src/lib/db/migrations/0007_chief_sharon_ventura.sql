DROP INDEX `idx_relevance_pub`;--> statement-breakpoint
DROP INDEX `idx_recency_pub`;--> statement-breakpoint
CREATE INDEX `idx_source_score_pub` ON `articles` (`source_id`,`score`,`published_at`);