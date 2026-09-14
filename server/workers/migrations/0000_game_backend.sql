CREATE TABLE `accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`salt` text NOT NULL,
	`password` text NOT NULL,
	`economy_id` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `accounts_name_unique` ON `accounts` (`name`);--> statement-breakpoint
CREATE TABLE `commands` (
	`room_id` text NOT NULL,
	`account_id` text NOT NULL,
	`key` text NOT NULL,
	`digest` text NOT NULL,
	`response` text NOT NULL,
	PRIMARY KEY(`room_id`, `account_id`, `key`)
);
--> statement-breakpoint
CREATE TABLE `display_profiles` (
	`account_id` text PRIMARY KEY NOT NULL,
	`subject_hash` text NOT NULL,
	`body` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `events` (
	`room_id` text NOT NULL,
	`version` integer NOT NULL,
	`body` text NOT NULL,
	PRIMARY KEY(`room_id`, `version`)
);
--> statement-breakpoint
CREATE TABLE `grants` (
	`id` text PRIMARY KEY NOT NULL,
	`hash` text NOT NULL,
	`room_id` text NOT NULL,
	`match_id` text NOT NULL,
	`seat_id` text NOT NULL,
	`account_id` text NOT NULL,
	`expires` integer NOT NULL,
	`max_actions` integer NOT NULL,
	`used` integer DEFAULT 0 NOT NULL,
	`revoked` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `grants_hash_unique` ON `grants` (`hash`);--> statement-breakpoint
CREATE TABLE `managed_identities` (
	`issuer` text NOT NULL,
	`subject` text NOT NULL,
	`account_id` text NOT NULL,
	PRIMARY KEY(`issuer`, `subject`),
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `managed_identities_account_id_unique` ON `managed_identities` (`account_id`);--> statement-breakpoint
CREATE TABLE `managed_nonces` (
	`nonce` text PRIMARY KEY NOT NULL,
	`expires` integer NOT NULL,
	`body` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `meta` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `packages` (
	`hash` text PRIMARY KEY NOT NULL,
	`publisher_id` text NOT NULL,
	`game_id` text NOT NULL,
	`version` text NOT NULL,
	`body` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `packages_publisher_id_game_id_version_unique` ON `packages` (`publisher_id`,`game_id`,`version`);--> statement-breakpoint
CREATE TABLE `rate_buckets` (
	`key` text PRIMARY KEY NOT NULL,
	`window` integer NOT NULL,
	`count` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `rooms` (
	`id` text PRIMARY KEY NOT NULL,
	`body` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`hash` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`expires` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `transaction_reads` (
	`id` text NOT NULL,
	`valid` integer NOT NULL,
	CONSTRAINT "read_conflict" CHECK("transaction_reads"."valid"=1)
);
--> statement-breakpoint
CREATE TABLE `transaction_writes` (
	`id` text NOT NULL,
	`valid` integer NOT NULL,
	CONSTRAINT "write_requirement" CHECK("transaction_writes"."valid"=1)
);
