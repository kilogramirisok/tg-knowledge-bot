CREATE TABLE `knowledge_entries` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`topic_question` text NOT NULL,
	`best_answer_text` text NOT NULL,
	`confidence_score` real NOT NULL,
	`source_message_ids` text,
	`contributor_user_ids` text,
	`tags` text,
	`category` text,
	`embedding` text,
	`version` integer DEFAULT 1,
	`is_active` integer DEFAULT true,
	`created_at` integer DEFAULT (unixepoch()),
	`updated_at` integer DEFAULT (unixepoch())
);
--> statement-breakpoint
CREATE TABLE `messages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tg_message_id` integer NOT NULL,
	`user_id` integer,
	`chat_id` integer NOT NULL,
	`text` text,
	`reply_to_message_id` integer,
	`classification` text,
	`quality_score` real,
	`embedding` text,
	`reactions_count` integer DEFAULT 0,
	`processed_at` integer,
	`timestamp` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch()),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `messages_chat_tg_idx` ON `messages` (`chat_id`,`tg_message_id`);--> statement-breakpoint
CREATE INDEX `messages_classification_idx` ON `messages` (`classification`);--> statement-breakpoint
CREATE INDEX `messages_processed_idx` ON `messages` (`processed_at`);--> statement-breakpoint
CREATE TABLE `user_activity_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`date` text NOT NULL,
	`message_count` integer DEFAULT 0,
	`answers_given` integer DEFAULT 0,
	`reactions_received` integer DEFAULT 0,
	`entries_curated` integer DEFAULT 0,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `activity_user_date_idx` ON `user_activity_log` (`user_id`,`date`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tg_user_id` integer NOT NULL,
	`username` text,
	`display_name` text,
	`reputation_score` real DEFAULT 0,
	`message_count` integer DEFAULT 0,
	`answers_given` integer DEFAULT 0,
	`reactions_received` integer DEFAULT 0,
	`entries_curated` integer DEFAULT 0,
	`last_active_at` integer,
	`created_at` integer DEFAULT (unixepoch()),
	`updated_at` integer DEFAULT (unixepoch())
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_tg_user_id_unique` ON `users` (`tg_user_id`);