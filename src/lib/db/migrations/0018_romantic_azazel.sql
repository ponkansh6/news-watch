ALTER TABLE `gemini_request_attempts` ADD `owner_token_hash` text;--> statement-breakpoint
ALTER TABLE `gemini_request_attempts` ADD `lease_kind` text;--> statement-breakpoint
ALTER TABLE `gemini_request_attempts` ADD `deployment_id` text;--> statement-breakpoint
ALTER TABLE `gemini_request_attempts` ADD `recovery_after` text;