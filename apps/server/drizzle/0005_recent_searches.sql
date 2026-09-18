CREATE TABLE `recent_searches` (
	`key` text PRIMARY KEY NOT NULL,
	`filters` text NOT NULL,
	`searched_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
