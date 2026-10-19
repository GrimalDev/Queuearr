CREATE TABLE `download_search_jobs` (
	`download_id` integer PRIMARY KEY NOT NULL,
	`scopes` text DEFAULT '[]' NOT NULL,
	`state` text DEFAULT 'pending' NOT NULL,
	`indexer` text,
	`submitted_at` integer,
	`next_attempt_at` integer DEFAULT 0 NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`download_id`) REFERENCES `monitored_downloads`(`id`) ON UPDATE no action ON DELETE cascade
);
