ALTER TABLE `movie_audio_jobs` ADD `donor_release_key` text;--> statement-breakpoint
ALTER TABLE `movie_audio_jobs` ADD `rejected_donors` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `movie_audio_jobs` ADD `replace_donor` integer DEFAULT false NOT NULL;