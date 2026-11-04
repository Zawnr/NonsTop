CREATE TABLE `changes` (
	`seq` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`op_id` text NOT NULL,
	`entity` text NOT NULL,
	`entity_id` text NOT NULL,
	`field` text NOT NULL,
	`value` text NOT NULL,
	`hlc` text NOT NULL,
	`device_id` text NOT NULL,
	`applied` integer NOT NULL,
	`received_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `changes_op_id_unique` ON `changes` (`op_id`);--> statement-breakpoint
CREATE INDEX `changes_applied_seq` ON `changes` (`applied`,`seq`);--> statement-breakpoint
CREATE TABLE `field_state` (
	`entity` text NOT NULL,
	`entity_id` text NOT NULL,
	`field` text NOT NULL,
	`value` text NOT NULL,
	`hlc` text NOT NULL,
	PRIMARY KEY(`entity`, `entity_id`, `field`)
);
