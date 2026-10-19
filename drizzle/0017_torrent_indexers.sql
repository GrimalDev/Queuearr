CREATE TABLE `torrent_indexers` (
	`hash` text PRIMARY KEY NOT NULL,
	`indexer` text NOT NULL,
	`source` text NOT NULL,
	`updated_at` integer NOT NULL
);
