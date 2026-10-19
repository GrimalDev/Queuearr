CREATE TABLE `download_transfers` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`download_id` integer NOT NULL,
	`hash` text NOT NULL,
	FOREIGN KEY (`download_id`) REFERENCES `monitored_downloads`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `download_transfers_download_hash_unique` ON `download_transfers` (`download_id`,`hash`);--> statement-breakpoint
ALTER TABLE `download_search_jobs` ADD `estimated_languages` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `movie_audio_jobs` ADD `donor_metadata` text;--> statement-breakpoint
ALTER TABLE `movie_audio_jobs` ADD `estimated_languages` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `torrent_indexers` ADD `audio_languages` text;