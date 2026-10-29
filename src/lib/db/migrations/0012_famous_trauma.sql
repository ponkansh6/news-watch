CREATE TABLE `refresh_job_slot` (
	`id` integer PRIMARY KEY NOT NULL,
	`owner_kind` text,
	`owner_id` text,
	`owner_token_hash` text,
	`acquired_at` text
);
--> statement-breakpoint
CREATE TABLE `refresh_job_sources` (
	`job_id` text NOT NULL,
	`source_id` text NOT NULL,
	`ordinal` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`adapter_started_at` text,
	`saved_at` text,
	`cache_invalidated_at` text,
	`completed_at` text,
	`result_count` integer,
	`error_code` text,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `refresh_jobs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `refresh_job_sources_job_source_unique` ON `refresh_job_sources` (`job_id`,`source_id`);--> statement-breakpoint
CREATE INDEX `idx_refresh_job_sources_order` ON `refresh_job_sources` (`job_id`,`ordinal`);--> statement-breakpoint
CREATE TABLE `refresh_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`owner_token_hash` text NOT NULL,
	`source_ids` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`workflow_run_id` text,
	`current_source_id` text,
	`revision` integer DEFAULT 0 NOT NULL,
	`next_eligible_at` text,
	`error_code` text,
	`created_at` text NOT NULL,
	`started_at` text,
	`completed_at` text,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `refresh_jobs_workflow_run_id_unique` ON `refresh_jobs` (`workflow_run_id`);--> statement-breakpoint
CREATE INDEX `idx_refresh_jobs_status_updated` ON `refresh_jobs` (`status`,`updated_at`);