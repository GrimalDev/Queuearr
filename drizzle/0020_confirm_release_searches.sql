ALTER TABLE `download_search_jobs` ADD `search_failures` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `movie_audio_jobs` ADD `search_failures` integer DEFAULT 0 NOT NULL;