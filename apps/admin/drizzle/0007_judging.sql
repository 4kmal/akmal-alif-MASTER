CREATE TABLE `judging_records` (
	`event_id` text NOT NULL,
	`record_key` text NOT NULL,
	`version` integer NOT NULL DEFAULT 1,
	`data_json` text NOT NULL,
	`updated_at` text NOT NULL,
	`updated_by` text NOT NULL,
	PRIMARY KEY (`event_id`, `record_key`)
);
--> statement-breakpoint
CREATE INDEX `idx_judging_records_event` ON `judging_records` (`event_id`, `updated_at`);
--> statement-breakpoint
CREATE TABLE `judging_mutations` (
	`event_id` text NOT NULL,
	`mutation_id` text NOT NULL,
	`record_key` text NOT NULL,
	`base_version` integer NOT NULL,
	`request_hash` text NOT NULL,
	`response_json` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY (`event_id`, `mutation_id`)
);
--> statement-breakpoint
CREATE TABLE `judging_events` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`event_type` text NOT NULL,
	`record_key` text,
	`mutation_id` text,
	`actor` text NOT NULL,
	`device_id` text,
	`payload_json` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_judging_events_event_created` ON `judging_events` (`event_id`, `created_at`);
--> statement-breakpoint
CREATE TABLE `judging_pair_codes` (
	`event_id` text NOT NULL,
	`code_hash` text NOT NULL,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL,
	`used_at` text,
	`created_by` text NOT NULL,
	PRIMARY KEY (`event_id`, `code_hash`)
);
--> statement-breakpoint
CREATE INDEX `idx_judging_pair_codes_expiry` ON `judging_pair_codes` (`event_id`, `expires_at`);
--> statement-breakpoint
CREATE TABLE `judging_pair_attempts` (
	`event_id` text NOT NULL,
	`client_hash` text NOT NULL,
	`window_started_at` integer NOT NULL,
	`attempts` integer NOT NULL DEFAULT 0,
	PRIMARY KEY (`event_id`, `client_hash`)
);
--> statement-breakpoint
CREATE TABLE `judging_devices` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`name` text NOT NULL,
	`token_hash` text NOT NULL UNIQUE,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL,
	`last_seen_at` text,
	`revoked_at` text,
	`paired_by` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_judging_devices_event` ON `judging_devices` (`event_id`, `revoked_at`, `expires_at`);
--> statement-breakpoint
CREATE TABLE `judging_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`team_id` text NOT NULL,
	`status` text NOT NULL CHECK (`status` IN ('queued', 'running', 'completed', 'failed', 'cancelled')),
	`requested_by` text NOT NULL,
	`device_id` text,
	`input_hash` text NOT NULL,
	`progress` integer NOT NULL DEFAULT 0,
	`draft_json` text,
	`error` text,
	`attempts` integer NOT NULL DEFAULT 0,
	`cancel_requested` integer NOT NULL DEFAULT 0,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`started_at` text,
	`finished_at` text
);
--> statement-breakpoint
CREATE INDEX `idx_judging_jobs_queue` ON `judging_jobs` (`event_id`, `status`, `created_at`);
--> statement-breakpoint
CREATE INDEX `idx_judging_jobs_team` ON `judging_jobs` (`event_id`, `team_id`, `created_at`);
