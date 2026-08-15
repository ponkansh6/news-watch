CREATE TABLE `not_for_me` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`article_id` integer NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`article_id`) REFERENCES `articles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `not_for_me_article_id_unique` ON `not_for_me` (`article_id`);--> statement-breakpoint
ALTER TABLE `preference_profiles` ADD `not_for_me_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `preference_profiles` ADD `not_for_me_max_id` integer DEFAULT 0 NOT NULL;