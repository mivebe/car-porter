CREATE TABLE `opened_lots` (
	`lot_id` text PRIMARY KEY NOT NULL,
	`opened_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_lot_inputs` (
	`lot_id` text PRIMARY KEY NOT NULL,
	`vin_override` text,
	`bid_override_usd_cents` integer,
	`repair_estimate_eur_cents` integer DEFAULT 0 NOT NULL,
	`fees_reduced` integer DEFAULT false NOT NULL,
	`include_sofia_to_bg` integer DEFAULT true NOT NULL,
	`market_match` text DEFAULT '{"trim":true,"mileage":false,"transmission":false}' NOT NULL,
	`market_sources` text,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_lot_inputs`("lot_id", "vin_override", "bid_override_usd_cents", "repair_estimate_eur_cents", "fees_reduced", "include_sofia_to_bg", "market_match", "market_sources", "updated_at") SELECT "lot_id", "vin_override", "bid_override_usd_cents", "repair_estimate_eur_cents", "fees_reduced", "include_sofia_to_bg", "market_match", "market_sources", "updated_at" FROM `lot_inputs`;--> statement-breakpoint
DROP TABLE `lot_inputs`;--> statement-breakpoint
ALTER TABLE `__new_lot_inputs` RENAME TO `lot_inputs`;--> statement-breakpoint
PRAGMA foreign_keys=ON;