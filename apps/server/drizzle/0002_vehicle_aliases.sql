-- IF NOT EXISTS: an earlier draft of this migration (with an external_make column) was applied to
-- some dev databases; 0003 rebuilds the table from the columns both shapes share.
CREATE TABLE IF NOT EXISTS `vehicle_aliases` (
	`source` text NOT NULL,
	`kind` text NOT NULL,
	`external_name` text NOT NULL,
	`canonical_make` text NOT NULL,
	`canonical` text NOT NULL,
	`match` text,
	`lot_count` integer,
	`last_seen_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	PRIMARY KEY(`source`, `kind`, `external_name`, `canonical_make`, `canonical`)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `vehicle_aliases_canonical_idx` ON `vehicle_aliases` (`canonical_make`,`canonical`);