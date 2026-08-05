CREATE TABLE `accepted_answer` (
	`id` text PRIMARY KEY NOT NULL,
	`question_id` text NOT NULL,
	`position` integer NOT NULL,
	`text` text NOT NULL,
	FOREIGN KEY (`question_id`) REFERENCES `question`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `accepted_answer_question_idx` ON `accepted_answer` (`question_id`,`position`);--> statement-breakpoint
CREATE TABLE `attachment` (
	`id` text PRIMARY KEY NOT NULL,
	`question_id` text NOT NULL,
	`position` integer NOT NULL,
	`kind` text NOT NULL,
	`mime_type` text NOT NULL,
	`original_name` text NOT NULL,
	`ext` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`checksum` text NOT NULL,
	`show_on_player_devices` integer DEFAULT false NOT NULL,
	`duration_ms` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`question_id`) REFERENCES `question`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `attachment_question_idx` ON `attachment` (`question_id`,`position`);--> statement-breakpoint
CREATE INDEX `attachment_checksum_idx` ON `attachment` (`checksum`);--> statement-breakpoint
CREATE TABLE `game` (
	`id` text PRIMARY KEY NOT NULL,
	`source_quiz_id` text,
	`quiz_name` text NOT NULL,
	`quiz_revision` integer NOT NULL,
	`code` text NOT NULL,
	`status` text DEFAULT 'SETUP' NOT NULL,
	`default_player_locale` text DEFAULT 'en' NOT NULL,
	`created_at` integer NOT NULL,
	`started_at` integer,
	`finished_at` integer,
	FOREIGN KEY (`source_quiz_id`) REFERENCES `quiz`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `game_active_code_idx` ON `game` (`code`) WHERE status IN ('SETUP','LIVE');--> statement-breakpoint
CREATE INDEX `game_quiz_status_idx` ON `game` (`source_quiz_id`,`status`);--> statement-breakpoint
CREATE TABLE `game_accepted_answer` (
	`id` text PRIMARY KEY NOT NULL,
	`game_id` text NOT NULL,
	`game_question_id` text NOT NULL,
	`position` integer NOT NULL,
	`text` text NOT NULL,
	FOREIGN KEY (`game_id`) REFERENCES `game`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`game_question_id`) REFERENCES `game_question`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `game_accepted_answer_question_idx` ON `game_accepted_answer` (`game_question_id`,`position`);--> statement-breakpoint
CREATE TABLE `game_answer` (
	`id` text PRIMARY KEY NOT NULL,
	`game_id` text NOT NULL,
	`game_question_id` text NOT NULL,
	`team_id` text NOT NULL,
	`text` text,
	`selected_option_id` text,
	`is_draft` integer DEFAULT true NOT NULL,
	`submitted_at` integer,
	`entered_by_master` integer DEFAULT false NOT NULL,
	`verdict` text DEFAULT 'PENDING' NOT NULL,
	`points_awarded` integer DEFAULT 0 NOT NULL,
	`validated_at` integer,
	FOREIGN KEY (`game_id`) REFERENCES `game`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`game_question_id`) REFERENCES `game_question`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`team_id`) REFERENCES `game_team`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`selected_option_id`) REFERENCES `game_question_option`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `game_answer_unique_idx` ON `game_answer` (`game_id`,`game_question_id`,`team_id`);--> statement-breakpoint
CREATE INDEX `game_answer_question_idx` ON `game_answer` (`game_question_id`);--> statement-breakpoint
CREATE INDEX `game_answer_pending_idx` ON `game_answer` (`game_id`,`verdict`);--> statement-breakpoint
CREATE TABLE `game_answer_draft` (
	`game_id` text NOT NULL,
	`game_question_id` text NOT NULL,
	`team_id` text NOT NULL,
	`text` text,
	`selected_option_id` text,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`game_question_id`, `team_id`),
	FOREIGN KEY (`game_id`) REFERENCES `game`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`game_question_id`) REFERENCES `game_question`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`team_id`) REFERENCES `game_team`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`selected_option_id`) REFERENCES `game_question_option`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `game_attachment` (
	`id` text PRIMARY KEY NOT NULL,
	`game_id` text NOT NULL,
	`game_question_id` text NOT NULL,
	`position` integer NOT NULL,
	`kind` text NOT NULL,
	`mime_type` text NOT NULL,
	`original_name` text NOT NULL,
	`ext` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`checksum` text NOT NULL,
	`show_on_player_devices` integer DEFAULT false NOT NULL,
	`duration_ms` integer,
	FOREIGN KEY (`game_id`) REFERENCES `game`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`game_question_id`) REFERENCES `game_question`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `game_attachment_question_idx` ON `game_attachment` (`game_question_id`,`position`);--> statement-breakpoint
CREATE INDEX `game_attachment_checksum_idx` ON `game_attachment` (`checksum`);--> statement-breakpoint
CREATE TABLE `game_buzz` (
	`id` text PRIMARY KEY NOT NULL,
	`game_id` text NOT NULL,
	`game_question_id` text NOT NULL,
	`team_id` text NOT NULL,
	`received_at` integer NOT NULL,
	`offset_ms` integer NOT NULL,
	`outcome` text NOT NULL,
	FOREIGN KEY (`game_id`) REFERENCES `game`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`game_question_id`) REFERENCES `game_question`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`team_id`) REFERENCES `game_team`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `game_buzz_question_idx` ON `game_buzz` (`game_question_id`,`received_at`);--> statement-breakpoint
CREATE TABLE `game_device` (
	`id` text PRIMARY KEY NOT NULL,
	`game_id` text NOT NULL,
	`team_id` text NOT NULL,
	`device_token` text NOT NULL,
	`first_seen_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	FOREIGN KEY (`game_id`) REFERENCES `game`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`team_id`) REFERENCES `game_team`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `game_device_token_idx` ON `game_device` (`device_token`);--> statement-breakpoint
CREATE INDEX `game_device_team_idx` ON `game_device` (`game_id`,`team_id`);--> statement-breakpoint
CREATE TABLE `game_event` (
	`id` text PRIMARY KEY NOT NULL,
	`game_id` text NOT NULL,
	`seq` integer NOT NULL,
	`type` text NOT NULL,
	`payload` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`game_id`) REFERENCES `game`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `game_event_game_seq_idx` ON `game_event` (`game_id`,`seq`);--> statement-breakpoint
CREATE TABLE `game_jeopardy_category` (
	`id` text PRIMARY KEY NOT NULL,
	`game_id` text NOT NULL,
	`game_round_id` text NOT NULL,
	`source_id` text,
	`position` integer NOT NULL,
	`name` text NOT NULL,
	FOREIGN KEY (`game_id`) REFERENCES `game`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`game_round_id`) REFERENCES `game_round`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_id`) REFERENCES `jeopardy_category`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `game_jeopardy_category_round_position_idx` ON `game_jeopardy_category` (`game_round_id`,`position`);--> statement-breakpoint
CREATE TABLE `game_keyword_mark` (
	`id` text PRIMARY KEY NOT NULL,
	`game_id` text NOT NULL,
	`game_question_id` text NOT NULL,
	`game_keyword_id` text NOT NULL,
	`team_id` text,
	`marked_at` integer NOT NULL,
	`revoked_at` integer,
	FOREIGN KEY (`game_id`) REFERENCES `game`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`game_question_id`) REFERENCES `game_question`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`game_keyword_id`) REFERENCES `game_question_keyword`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`team_id`) REFERENCES `game_team`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `game_keyword_mark_unique_idx` ON `game_keyword_mark` (`game_keyword_id`);--> statement-breakpoint
CREATE INDEX `game_keyword_mark_question_idx` ON `game_keyword_mark` (`game_question_id`);--> statement-breakpoint
CREATE TABLE `game_question` (
	`id` text PRIMARY KEY NOT NULL,
	`game_id` text NOT NULL,
	`game_round_id` text NOT NULL,
	`game_category_id` text,
	`source_id` text,
	`position` integer NOT NULL,
	`prompt` text NOT NULL,
	`answer_method` text NOT NULL,
	`points` integer NOT NULL,
	`timer_ms` integer,
	`master_notes` text,
	`config` text NOT NULL,
	FOREIGN KEY (`game_id`) REFERENCES `game`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`game_round_id`) REFERENCES `game_round`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`game_category_id`) REFERENCES `game_jeopardy_category`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_id`) REFERENCES `question`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `game_question_round_position_idx` ON `game_question` (`game_round_id`,`position`);--> statement-breakpoint
CREATE INDEX `game_question_category_position_idx` ON `game_question` (`game_category_id`,`position`);--> statement-breakpoint
CREATE INDEX `game_question_game_idx` ON `game_question` (`game_id`);--> statement-breakpoint
CREATE TABLE `game_question_keyword` (
	`id` text PRIMARY KEY NOT NULL,
	`game_id` text NOT NULL,
	`game_question_id` text NOT NULL,
	`position` integer NOT NULL,
	`text` text NOT NULL,
	`word_lengths` text NOT NULL,
	FOREIGN KEY (`game_id`) REFERENCES `game`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`game_question_id`) REFERENCES `game_question`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `game_question_keyword_question_idx` ON `game_question_keyword` (`game_question_id`,`position`);--> statement-breakpoint
CREATE TABLE `game_question_option` (
	`id` text PRIMARY KEY NOT NULL,
	`game_id` text NOT NULL,
	`game_question_id` text NOT NULL,
	`position` integer NOT NULL,
	`text` text NOT NULL,
	`is_correct` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`game_id`) REFERENCES `game`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`game_question_id`) REFERENCES `game_question`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `game_question_option_question_idx` ON `game_question_option` (`game_question_id`,`position`);--> statement-breakpoint
CREATE TABLE `game_round` (
	`id` text PRIMARY KEY NOT NULL,
	`game_id` text NOT NULL,
	`source_id` text,
	`position` integer NOT NULL,
	`type` text NOT NULL,
	`title` text NOT NULL,
	`default_points` integer DEFAULT 10 NOT NULL,
	`default_timer_ms` integer,
	`config` text NOT NULL,
	FOREIGN KEY (`game_id`) REFERENCES `game`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_id`) REFERENCES `round`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `game_round_game_position_idx` ON `game_round` (`game_id`,`position`);--> statement-breakpoint
CREATE TABLE `game_score_adjustment` (
	`id` text PRIMARY KEY NOT NULL,
	`game_id` text NOT NULL,
	`team_id` text NOT NULL,
	`delta` integer NOT NULL,
	`reason` text,
	`announced` integer DEFAULT true NOT NULL,
	`revoked_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`game_id`) REFERENCES `game`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`team_id`) REFERENCES `game_team`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `game_score_adjustment_team_idx` ON `game_score_adjustment` (`game_id`,`team_id`);--> statement-breakpoint
CREATE TABLE `game_team` (
	`id` text PRIMARY KEY NOT NULL,
	`game_id` text NOT NULL,
	`position` integer NOT NULL,
	`name` text NOT NULL,
	`colour` text NOT NULL,
	`score` integer DEFAULT 0 NOT NULL,
	`eliminated_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`game_id`) REFERENCES `game`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `game_team_game_position_idx` ON `game_team` (`game_id`,`position`);--> statement-breakpoint
CREATE TABLE `jeopardy_category` (
	`id` text PRIMARY KEY NOT NULL,
	`round_id` text NOT NULL,
	`position` integer NOT NULL,
	`name` text NOT NULL,
	FOREIGN KEY (`round_id`) REFERENCES `round`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `jeopardy_category_round_position_idx` ON `jeopardy_category` (`round_id`,`position`);--> statement-breakpoint
CREATE TABLE `question` (
	`id` text PRIMARY KEY NOT NULL,
	`round_id` text NOT NULL,
	`category_id` text,
	`position` integer NOT NULL,
	`prompt` text NOT NULL,
	`answer_method` text NOT NULL,
	`points` integer NOT NULL,
	`timer_ms` integer,
	`master_notes` text,
	`config` text NOT NULL,
	FOREIGN KEY (`round_id`) REFERENCES `round`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`category_id`) REFERENCES `jeopardy_category`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `question_round_position_idx` ON `question` (`round_id`,`position`);--> statement-breakpoint
CREATE INDEX `question_category_position_idx` ON `question` (`category_id`,`position`);--> statement-breakpoint
CREATE TABLE `question_keyword` (
	`id` text PRIMARY KEY NOT NULL,
	`question_id` text NOT NULL,
	`position` integer NOT NULL,
	`text` text NOT NULL,
	`word_lengths` text NOT NULL,
	FOREIGN KEY (`question_id`) REFERENCES `question`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `question_keyword_question_idx` ON `question_keyword` (`question_id`,`position`);--> statement-breakpoint
CREATE TABLE `question_option` (
	`id` text PRIMARY KEY NOT NULL,
	`question_id` text NOT NULL,
	`position` integer NOT NULL,
	`text` text NOT NULL,
	`is_correct` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`question_id`) REFERENCES `question`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `question_option_question_idx` ON `question_option` (`question_id`,`position`);--> statement-breakpoint
CREATE TABLE `quiz` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `round` (
	`id` text PRIMARY KEY NOT NULL,
	`quiz_id` text NOT NULL,
	`position` integer NOT NULL,
	`type` text NOT NULL,
	`title` text NOT NULL,
	`default_points` integer DEFAULT 10 NOT NULL,
	`default_timer_ms` integer,
	`config` text NOT NULL,
	FOREIGN KEY (`quiz_id`) REFERENCES `quiz`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `round_quiz_position_idx` ON `round` (`quiz_id`,`position`);