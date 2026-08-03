CREATE TABLE `preference_profiles` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`analysis` text NOT NULL,
	`prompt_section` text NOT NULL,
	`favorite_count` integer NOT NULL,
	`favorite_max_id` integer DEFAULT 0 NOT NULL,
	`model` text NOT NULL,
	`created_at` text NOT NULL
);
