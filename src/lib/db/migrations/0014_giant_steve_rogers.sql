CREATE TABLE `gemini_request_attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`started_at` text NOT NULL,
	`completed_at` text,
	`outcome` text DEFAULT 'started' NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_gemini_request_attempts_completed_at` ON `gemini_request_attempts` (`completed_at`);--> statement-breakpoint
CREATE INDEX `idx_gemini_request_attempts_owner` ON `gemini_request_attempts` (`owner_id`);--> statement-breakpoint
CREATE TABLE `gemini_request_slot` (
	`id` integer PRIMARY KEY NOT NULL,
	`owner_id` text,
	`owner_token_hash` text,
	`acquired_at` text
);
