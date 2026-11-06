CREATE TABLE `automatic_download_retries` (
  `key` text PRIMARY KEY NOT NULL,
  `download_id` integer NOT NULL REFERENCES `monitored_downloads`(`id`) ON DELETE cascade,
  `failed_at` integer NOT NULL,
  `retry_deadline` integer NOT NULL
);
