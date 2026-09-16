CREATE TABLE `game_spend_participants` (
	`account_id` text NOT NULL,
	`match_id` text NOT NULL,
	PRIMARY KEY(`account_id`, `match_id`)
);
