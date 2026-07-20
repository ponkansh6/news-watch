CREATE TABLE `hatena_feeds` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`domain` text NOT NULL,
	`feed_url` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`bookmark_count` integer DEFAULT 0 NOT NULL,
	`last_fetched_at` text,
	`error_count` integer DEFAULT 0 NOT NULL,
	`last_error` text,
	`discovered_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `hatena_feeds_domain_unique` ON `hatena_feeds` (`domain`);--> statement-breakpoint
CREATE INDEX `idx_hatena_feeds_status` ON `hatena_feeds` (`status`);--> statement-breakpoint
CREATE INDEX `idx_hatena_feeds_domain` ON `hatena_feeds` (`domain`);