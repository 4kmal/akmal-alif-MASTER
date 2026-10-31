CREATE TABLE `cloudflare_observability_snapshots` (
	`snapshot_id` text PRIMARY KEY NOT NULL,
	`scope` text NOT NULL,
	`captured_at` integer NOT NULL,
	`from_at` text NOT NULL,
	`to_at` text NOT NULL,
	`status` text NOT NULL,
	`report_json` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_cloudflare_observability_snapshots_scope_time` ON `cloudflare_observability_snapshots` (`scope`,`captured_at`);
--> statement-breakpoint
CREATE TABLE `cloudflare_observability_daily` (
	`day` text NOT NULL,
	`scope` text NOT NULL,
	`metric_key` text NOT NULL,
	`resource_id` text NOT NULL DEFAULT '',
	`unit` text NOT NULL,
	`value` real,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`day`, `scope`, `metric_key`, `resource_id`)
);
--> statement-breakpoint
CREATE INDEX `idx_cloudflare_observability_daily_scope_day` ON `cloudflare_observability_daily` (`scope`,`day`);
--> statement-breakpoint
CREATE INDEX `idx_cloudflare_observability_daily_metric` ON `cloudflare_observability_daily` (`metric_key`,`day`);
