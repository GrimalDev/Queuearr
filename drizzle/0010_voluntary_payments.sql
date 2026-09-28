CREATE TABLE `payment_settings` (
	`id` integer PRIMARY KEY NOT NULL,
	`enabled` integer NOT NULL,
	`payment_url` text NOT NULL
);
--> statement-breakpoint
ALTER TABLE `users` ADD `payment_reported_at` integer;--> statement-breakpoint
ALTER TABLE `users` ADD `payment_reminders_paused_until` integer;--> statement-breakpoint
ALTER TABLE `users` ADD `payment_deferred_at` integer;--> statement-breakpoint
ALTER TABLE `users` ADD `payment_deferral_count` integer DEFAULT 0 NOT NULL;
