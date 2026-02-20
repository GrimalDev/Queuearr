ALTER TABLE `users` ADD `active` integer NOT NULL DEFAULT 0;
--> statement-breakpoint
UPDATE `users` SET `active` = 1;
