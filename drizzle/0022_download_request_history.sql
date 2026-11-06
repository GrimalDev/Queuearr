CREATE TABLE `download_requests` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `download_id` integer NOT NULL,
  `source` text NOT NULL,
  `media_id` integer NOT NULL,
  `cycle_started_at` integer NOT NULL,
  `scope` text NOT NULL,
  `user_id` text,
  `username` text,
  `requested_at` integer NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX `download_requests_scope_unique` ON `download_requests` (`download_id`, `cycle_started_at`, `scope`);--> statement-breakpoint
CREATE INDEX `download_requests_requested_at_index` ON `download_requests` (`requested_at`);--> statement-breakpoint
INSERT INTO `download_requests` (`download_id`, `source`, `media_id`, `cycle_started_at`, `scope`, `requested_at`)
SELECT `id`, `source`, `media_id`, `created_at`, '{"type":"legacy"}', `created_at` FROM `monitored_downloads`;
