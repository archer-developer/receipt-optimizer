ALTER TABLE "shops" ADD COLUMN "icon" text;
--> statement-breakpoint
UPDATE "shops" SET "icon" = 'assets/green-logo.svg' WHERE lower("name") LIKE '%green%';
--> statement-breakpoint
UPDATE "shops" SET "icon" = 'assets/edostavka-logo.webp' WHERE lower("name") LIKE '%edostavka%';
