ALTER TABLE "videos" ADD COLUMN "clips" jsonb;--> statement-breakpoint
ALTER TABLE "videos" ADD COLUMN "pov" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "videos" ADD COLUMN "description" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "videos" ADD COLUMN "options" jsonb DEFAULT '[]'::jsonb NOT NULL;