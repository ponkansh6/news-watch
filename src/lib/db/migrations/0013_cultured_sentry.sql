CREATE TABLE `refresh_job_batches` (
	`id` text PRIMARY KEY NOT NULL,
	`job_id` text NOT NULL,
	`ordinal` integer NOT NULL,
	`candidate_ids_json` text NOT NULL,
	`scoring_signature` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`result_json` text,
	`attempt_count` integer DEFAULT 0 NOT NULL,
	`error_code` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`completed_at` text,
	FOREIGN KEY (`job_id`) REFERENCES `refresh_jobs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `refresh_job_batches_job_ordinal_unique` ON `refresh_job_batches` (`job_id`,`ordinal`);--> statement-breakpoint
CREATE INDEX `idx_refresh_job_batches_job_state_order` ON `refresh_job_batches` (`job_id`,`status`,`ordinal`);--> statement-breakpoint
CREATE TABLE `refresh_job_candidates` (
	`id` text PRIMARY KEY NOT NULL,
	`job_id` text NOT NULL,
	`normalized_url` text NOT NULL,
	`payload_json` text NOT NULL,
	`content_hash` text NOT NULL,
	`scoring_signature` text NOT NULL,
	`representative_source_id` text NOT NULL,
	`source_ids_json` text NOT NULL,
	`ordinal` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`batch_id` text,
	`error_code` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `refresh_jobs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `refresh_job_candidates_job_url_unique` ON `refresh_job_candidates` (`job_id`,`normalized_url`);--> statement-breakpoint
CREATE INDEX `idx_refresh_job_candidates_job_state_order` ON `refresh_job_candidates` (`job_id`,`status`,`ordinal`);--> statement-breakpoint
CREATE INDEX `idx_refresh_job_candidates_batch` ON `refresh_job_candidates` (`batch_id`);