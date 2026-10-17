CREATE TABLE `movie_audio_jobs` (
	`tmdb_id` integer PRIMARY KEY NOT NULL,
	`state` text DEFAULT 'pending' NOT NULL,
	`detail` text DEFAULT 'Waiting for a suitable release.' NOT NULL,
	`donor_hash` text,
	`donor_language_id` integer,
	`restore_monitored` integer,
	`output_path` text,
	`updated_at` integer NOT NULL,
	`next_attempt_at` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `movie_audio_locks` (
	`id` integer PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `movie_audio_policies` (
	`tmdb_id` integer PRIMARY KEY NOT NULL,
	`radarr_movie_id` integer NOT NULL,
	`base_profile_id` integer NOT NULL,
	`required_languages` text NOT NULL
);
