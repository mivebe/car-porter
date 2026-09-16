CREATE TABLE `auction_records` (
	`id` text PRIMARY KEY NOT NULL,
	`site` text NOT NULL,
	`url` text NOT NULL,
	`auction` text,
	`lot_number` text,
	`vin` text,
	`year` integer,
	`make` text,
	`model` text,
	`trim` text,
	`engine` text,
	`fuel` text,
	`sale_date` integer,
	`final_price_usd_cents` integer,
	`odometer_miles` integer,
	`damage` text,
	`data` text NOT NULL,
	`first_seen_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `auction_records_vin_idx` ON `auction_records` (`vin`);--> statement-breakpoint
CREATE INDEX `auction_records_lot_idx` ON `auction_records` (`lot_number`);--> statement-breakpoint
CREATE INDEX `auction_records_mmy_idx` ON `auction_records` (`make`,`model`,`year`);--> statement-breakpoint
CREATE TABLE `lot_inputs` (
	`lot_id` text PRIMARY KEY NOT NULL,
	`vin_override` text,
	`bid_override_usd_cents` integer,
	`repair_estimate_eur_cents` integer DEFAULT 0 NOT NULL,
	`fees_reduced` integer DEFAULT false NOT NULL,
	`include_sofia_to_bg` integer DEFAULT true NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `lots` (
	`id` text PRIMARY KEY NOT NULL,
	`source` text NOT NULL,
	`lot_number` text NOT NULL,
	`vin` text,
	`year` integer,
	`make` text,
	`model` text,
	`data` text NOT NULL,
	`fetched_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `lots_vin_idx` ON `lots` (`vin`);--> statement-breakpoint
CREATE TABLE `market_listings` (
	`id` text PRIMARY KEY NOT NULL,
	`site` text NOT NULL,
	`title` text,
	`year` integer,
	`make` text,
	`model` text,
	`trim` text,
	`fuel` text,
	`transmission` text,
	`mileage_km` integer,
	`price_eur_cents` integer,
	`data` text NOT NULL,
	`first_seen_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`last_seen_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`removed_at` integer
);
--> statement-breakpoint
CREATE INDEX `market_listings_mmy_idx` ON `market_listings` (`make`,`model`,`year`);--> statement-breakpoint
CREATE TABLE `market_price_snapshots` (
	`listing_id` text NOT NULL,
	`price_eur_cents` integer NOT NULL,
	`seen_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	PRIMARY KEY(`listing_id`, `seen_at`)
);
--> statement-breakpoint
CREATE TABLE `scrape_cache` (
	`key` text PRIMARY KEY NOT NULL,
	`source` text NOT NULL,
	`payload` text NOT NULL,
	`fetched_at` integer NOT NULL,
	`expires_at` integer
);
--> statement-breakpoint
CREATE TABLE `selections` (
	`lot_id` text NOT NULL,
	`kind` text NOT NULL,
	`item_id` text NOT NULL,
	`included` integer NOT NULL,
	PRIMARY KEY(`lot_id`, `kind`, `item_id`)
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`id` integer PRIMARY KEY NOT NULL,
	`data` text NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `tracked_lots` (
	`lot_id` text PRIMARY KEY NOT NULL,
	`note` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
