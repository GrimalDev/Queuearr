ALTER TABLE `download_search_jobs` ADD `ranked_search` integer DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE `download_search_jobs` ADD `release_round` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `download_search_jobs` ADD `next_round_at` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `download_search_jobs` ADD `search_cursor` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `download_search_jobs` ADD `pending_episode_ids` text;
--> statement-breakpoint
CREATE TABLE `download_release_attempts` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `download_id` integer NOT NULL REFERENCES `monitored_downloads`(`id`) ON DELETE cascade,
  `cycle_started_at` integer NOT NULL,
  `identity` text NOT NULL,
  `title_digest` text NOT NULL,
  `round` integer NOT NULL,
  `kind` text NOT NULL,
  `attempted_at` integer NOT NULL,
  `retry_at` integer DEFAULT 0 NOT NULL,
  `owned_blocklist_ids` text DEFAULT '[]' NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `download_release_attempt_unique` ON `download_release_attempts` (`download_id`, `cycle_started_at`, `identity`);
