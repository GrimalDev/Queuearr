CREATE TABLE `notifications` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`url` text,
	`icon` text,
	`tag` text,
	`sent_by` text NOT NULL,
	`sent_at` integer NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`sent_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `users` DROP COLUMN `active`;