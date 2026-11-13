CREATE TABLE "rate_limit" (
	"key" text PRIMARY KEY NOT NULL,
	"windowStart" timestamp DEFAULT now() NOT NULL,
	"count" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "snapshot" ADD COLUMN "summary" jsonb DEFAULT '{}'::jsonb NOT NULL;