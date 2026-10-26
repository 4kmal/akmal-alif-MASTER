CREATE TABLE `portfolio_analytics_daily` (
	`day` text NOT NULL,
	`dimension` text NOT NULL,
	`dimension_value` text NOT NULL,
	`source` text NOT NULL,
	`event_count` integer DEFAULT 0 NOT NULL,
	`session_count` integer DEFAULT 0 NOT NULL,
	`session_hll` text DEFAULT '' NOT NULL,
	`active_ms` integer DEFAULT 0 NOT NULL,
	`visitor_hll` text DEFAULT '' NOT NULL,
	`first_event_at` integer,
	`last_event_at` integer,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`day`, `dimension`, `dimension_value`, `source`)
);
--> statement-breakpoint
CREATE INDEX `idx_portfolio_analytics_daily_dimension` ON `portfolio_analytics_daily` (`dimension`,`dimension_value`,`day`);--> statement-breakpoint
CREATE INDEX `idx_portfolio_analytics_daily_source` ON `portfolio_analytics_daily` (`source`,`day`);--> statement-breakpoint
CREATE TABLE `portfolio_analytics_events` (
	`event_id` text PRIMARY KEY NOT NULL,
	`event_type` text NOT NULL,
	`source_event_type` text,
	`path` text NOT NULL,
	`target` text,
	`progress` integer,
	`active_ms` integer,
	`media_id` text,
	`media_kind` text,
	`played_ms` integer,
	`duration_ms` integer,
	`referrer` text,
	`campaign_json` text,
	`shortlink_slug` text,
	`source` text DEFAULT 'portfolio' NOT NULL,
	`source_event_id` text,
	`event_at` integer NOT NULL,
	`received_at` integer NOT NULL,
	`visitor_key` text,
	`session_key` text,
	`session_started_at` integer,
	`ip` text,
	`user_agent` text,
	`country` text,
	`region` text,
	`city` text,
	`timezone` text,
	`latitude` real,
	`longitude` real,
	`colo` text,
	`is_bot` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_portfolio_analytics_events_at` ON `portfolio_analytics_events` (`event_at`);--> statement-breakpoint
CREATE INDEX `idx_portfolio_analytics_events_path` ON `portfolio_analytics_events` (`path`,`event_at`);--> statement-breakpoint
CREATE INDEX `idx_portfolio_analytics_events_type` ON `portfolio_analytics_events` (`event_type`,`event_at`);--> statement-breakpoint
CREATE INDEX `idx_portfolio_analytics_events_source` ON `portfolio_analytics_events` (`source`,`event_at`);--> statement-breakpoint
CREATE INDEX `idx_portfolio_analytics_events_session` ON `portfolio_analytics_events` (`session_key`,`event_at`);--> statement-breakpoint
CREATE TABLE `portfolio_analytics_state` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer NOT NULL
);
