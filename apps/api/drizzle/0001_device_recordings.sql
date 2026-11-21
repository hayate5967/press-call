CREATE TABLE "device_recordings" (
	"device_id" uuid PRIMARY KEY NOT NULL,
	"recording" boolean NOT NULL,
	"seq" integer NOT NULL,
	"started_at" timestamp with time zone,
	"stopped_at" timestamp with time zone,
	"acked_seq" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "device_recordings_seq_check" CHECK ("device_recordings"."seq" >= 0 AND "device_recordings"."acked_seq" >= 0)
);
--> statement-breakpoint
ALTER TABLE "device_recordings" ADD CONSTRAINT "device_recordings_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE no action ON UPDATE no action;