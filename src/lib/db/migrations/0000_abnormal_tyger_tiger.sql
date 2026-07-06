CREATE TABLE `articles` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`url` text NOT NULL,
	`url_to_image` text,
	`published_at` text NOT NULL,
	`source_name` text,
	`source_id` text,
	`author` text,
	`keyword` text NOT NULL,
	`summary` text,
	`relevance` real,
	`usefulness` real,
	`recency` real,
	`reason` text,
	`scored_at` text,
	`score` real,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `articles_url_unique` ON `articles` (`url`);--> statement-breakpoint
CREATE INDEX `idx_keyword` ON `articles` (`keyword`);--> statement-breakpoint
CREATE INDEX `idx_relevance_pub` ON `articles` (`relevance`,`published_at`);--> statement-breakpoint
CREATE INDEX `idx_recency_pub` ON `articles` (`recency`,`published_at`);--> statement-breakpoint
CREATE INDEX `idx_created_at` ON `articles` (`created_at`);