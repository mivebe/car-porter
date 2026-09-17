-- Auto rows recorded before the sites were read car-only: they hold boat, trailer and heavy-truck
-- names that no later scan replaces (a scan only rewrites the names it sees again). The user's own
-- assignments (origin 'manual') are kept; the next scan fills the auto rows back in.
DELETE FROM `vehicle_aliases` WHERE `origin` = 'auto';--> statement-breakpoint
DELETE FROM `scrape_cache` WHERE `key` LIKE 'aliases:%' OR `key` LIKE 'nhtsa:%';
