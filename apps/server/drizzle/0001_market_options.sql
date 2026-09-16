ALTER TABLE `lot_inputs` ADD `market_match` text DEFAULT '{"mileage":false,"transmission":false,"fuel":false}' NOT NULL;--> statement-breakpoint
ALTER TABLE `lot_inputs` ADD `market_sources` text;