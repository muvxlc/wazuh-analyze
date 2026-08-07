ALTER TABLE "incidents" ADD COLUMN "incident_number" text;--> statement-breakpoint
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_incident_number_unique" UNIQUE("incident_number");
