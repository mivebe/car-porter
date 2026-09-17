CREATE TABLE `vehicle_aliases` (
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
CREATE INDEX `vehicle_aliases_canonical_idx` ON `vehicle_aliases` (`canonical_make`,`canonical`);