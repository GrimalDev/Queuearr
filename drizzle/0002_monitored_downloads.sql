CREATE TABLE `monitored_downloads` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source` text NOT NULL,
	`media_id` integer NOT NULL,
	`title` text NOT NULL,
	`last_status` text,
	`completed_at` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `monitored_downloads_source_media_id_unique` ON `monitored_downloads` (`source`, `media_id`);
--> statement-breakpoint
CREATE TABLE `monitored_download_users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`download_id` integer NOT NULL,
	`user_id` text NOT NULL,
	FOREIGN KEY (`download_id`) REFERENCES `monitored_downloads`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `monitored_download_users_download_user_unique` ON `monitored_download_users` (`download_id`, `user_id`);
