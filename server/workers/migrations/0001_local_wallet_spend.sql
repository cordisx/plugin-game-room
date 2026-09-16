CREATE TABLE `game_spend_transactions` (
	`match_id` text PRIMARY KEY NOT NULL,
	`room_id` text NOT NULL,
	`body` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `game_wallet_bindings` (
	`account_id` text PRIMARY KEY NOT NULL,
	`body` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `game_wallet_challenges` (
	`nonce` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`expires` integer NOT NULL,
	`body` text NOT NULL
);
