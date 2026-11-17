ALTER TABLE `download_search_jobs` ADD `audio_description` integer DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE `movie_audio_jobs` ADD `audio_description` integer DEFAULT false NOT NULL;
--> statement-breakpoint
CREATE TABLE `download_media_checks` (
  `key` text PRIMARY KEY NOT NULL,
  `download_id` integer NOT NULL REFERENCES `monitored_downloads`(`id`) ON DELETE cascade,
  `hash` text NOT NULL,
  `cycle_started_at` integer NOT NULL,
  `state` text NOT NULL,
  `detail` text NOT NULL,
  `started_at` integer NOT NULL,
  `checked_bytes` integer DEFAULT 0 NOT NULL,
  `sequential_changed` integer DEFAULT false NOT NULL,
  `speed_changed` integer DEFAULT false NOT NULL,
  `previous_limit` integer DEFAULT 0 NOT NULL,
  `previous_limited` integer DEFAULT false NOT NULL,
  `updated_at` integer NOT NULL
);
