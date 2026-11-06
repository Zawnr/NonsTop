CREATE TABLE `reminders_sent` (
	`entity_id` text NOT NULL,
	`field` text NOT NULL,
	`fire_at` text NOT NULL,
	`sent_at` integer NOT NULL,
	PRIMARY KEY(`entity_id`, `field`, `fire_at`)
);
