ALTER TABLE `users` ADD `active` integer NOT NULL DEFAULT 0;
-- Activate all existing users (they predate the approval system)
UPDATE `users` SET `active` = 1;
