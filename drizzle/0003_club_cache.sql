CREATE TABLE "club_cache" (
	"clubId" text NOT NULL,
	"platform" text NOT NULL,
	"data" jsonb NOT NULL,
	"fetchedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "club_cache_clubId_platform_pk" PRIMARY KEY("clubId","platform")
);
