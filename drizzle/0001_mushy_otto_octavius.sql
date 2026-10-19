CREATE UNIQUE INDEX `assignment_class_challenge` ON `assignments` (`class_id`,`challenge_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `assignment_class_slug` ON `assignments` (`class_id`,`slug`);