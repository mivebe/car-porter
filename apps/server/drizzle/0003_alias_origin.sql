PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_vehicle_aliases` (
	`source` text NOT NULL,
	`kind` text NOT NULL,
	`external_name` text NOT NULL,
	`canonical_make` text NOT NULL,
	`canonical` text NOT NULL,
	`origin` text NOT NULL,
	`match` text,
	`lot_count` integer,
	`last_seen_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	PRIMARY KEY(`source`, `kind`, `external_name`, `canonical_make`, `canonical`, `origin`)
);
--> statement-breakpoint
INSERT INTO `__new_vehicle_aliases`("source", "kind", "external_name", "canonical_make", "canonical", "origin", "match", "lot_count", "last_seen_at") SELECT "source", "kind", "external_name", "canonical_make", "canonical", CASE WHEN "match" = 'manual' THEN 'manual' ELSE 'auto' END, CASE WHEN "match" = 'manual' THEN NULL ELSE "match" END, "lot_count", "last_seen_at" FROM `vehicle_aliases`;--> statement-breakpoint
DROP TABLE `vehicle_aliases`;--> statement-breakpoint
ALTER TABLE `__new_vehicle_aliases` RENAME TO `vehicle_aliases`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `vehicle_aliases_canonical_idx` ON `vehicle_aliases` (`canonical_make`,`canonical`);