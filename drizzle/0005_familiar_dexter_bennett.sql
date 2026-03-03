CREATE TABLE `invited_users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`email` text NOT NULL,
	`library_section_ids` text,
	`invited_at` integer,
	`invited_by` text,
	`plex_invite_sent` integer DEFAULT false,
	FOREIGN KEY (`invited_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `invited_users_email_unique` ON `invited_users` (`email`);
