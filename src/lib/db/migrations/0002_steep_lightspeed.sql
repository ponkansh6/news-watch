CREATE TABLE `keyword_embeddings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`keyword` text NOT NULL,
	`embedding` text NOT NULL,
	`model` text DEFAULT 'gemini-embedding-2' NOT NULL,
	`dimensions` integer DEFAULT 768 NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `keyword_embeddings_keyword_unique` ON `keyword_embeddings` (`keyword`);