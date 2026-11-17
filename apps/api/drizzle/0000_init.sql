CREATE TABLE "device_authorizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"device_code_hash" text NOT NULL,
	"user_code" text NOT NULL,
	"status" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_polled_at" timestamp with time zone,
	"user_id" uuid,
	"device_id" uuid,
	"device_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "device_authorizations_device_code_hash_unique" UNIQUE("device_code_hash"),
	CONSTRAINT "device_authorizations_user_code_unique" UNIQUE("user_code"),
	CONSTRAINT "device_authorizations_status_check" CHECK ("device_authorizations"."status" IN ('pending', 'approved', 'denied', 'consumed'))
);
--> statement-breakpoint
CREATE TABLE "device_settings" (
	"device_id" uuid PRIMARY KEY NOT NULL,
	"mode" text NOT NULL,
	"pause_mode" text,
	"pause_fixed_ms" integer,
	"pause_min_ms" integer,
	"pause_max_ms" integer,
	"still_threshold" real,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "device_settings_mode_check" CHECK ("device_settings"."mode" IN ('auto_signal', 'count_only')),
	CONSTRAINT "device_settings_pause_check" CHECK ((
  "device_settings"."mode" = 'count_only'
  AND "device_settings"."pause_mode" IS NULL AND "device_settings"."pause_fixed_ms" IS NULL
  AND "device_settings"."pause_min_ms" IS NULL AND "device_settings"."pause_max_ms" IS NULL
) OR (
  "device_settings"."mode" = 'auto_signal' AND "device_settings"."pause_mode" = 'fixed'
  AND "device_settings"."pause_fixed_ms" IS NOT NULL
  AND "device_settings"."pause_min_ms" IS NULL AND "device_settings"."pause_max_ms" IS NULL
) OR (
  "device_settings"."mode" = 'auto_signal' AND "device_settings"."pause_mode" = 'random'
  AND "device_settings"."pause_fixed_ms" IS NULL
  AND "device_settings"."pause_min_ms" IS NOT NULL AND "device_settings"."pause_max_ms" IS NOT NULL
  AND "device_settings"."pause_min_ms" <= "device_settings"."pause_max_ms"
)),
	CONSTRAINT "device_settings_pause_range_check" CHECK (("device_settings"."pause_fixed_ms" IS NULL OR "device_settings"."pause_fixed_ms" BETWEEN 200 AND 5000)
        AND ("device_settings"."pause_min_ms" IS NULL OR "device_settings"."pause_min_ms" BETWEEN 200 AND 5000)
        AND ("device_settings"."pause_max_ms" IS NULL OR "device_settings"."pause_max_ms" BETWEEN 200 AND 5000))
);
--> statement-breakpoint
CREATE TABLE "device_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"device_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "device_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "devices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"last_seen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "oauth_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"provider_subject" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "oauth_accounts_provider_subject_key" UNIQUE("provider","provider_subject")
);
--> statement-breakpoint
CREATE TABLE "refresh_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"family_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "refresh_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "reps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"set_id" uuid NOT NULL,
	"rep_index" smallint NOT NULL,
	"start_offset_ms" integer NOT NULL,
	"eccentric_ms" integer,
	"pause_target_ms" integer,
	"pause_actual_ms" integer,
	"reaction_ms" integer,
	"is_premature" boolean DEFAULT false NOT NULL,
	"concentric_ms" integer,
	"mean_velocity_mps" real,
	"peak_velocity_mps" real,
	"curve_hz" smallint,
	"velocity_curve" real[],
	CONSTRAINT "reps_set_id_rep_index_key" UNIQUE("set_id","rep_index"),
	CONSTRAINT "reps_rep_index_check" CHECK ("reps"."rep_index" >= 1)
);
--> statement-breakpoint
CREATE TABLE "set_raw_data" (
	"set_id" uuid PRIMARY KEY NOT NULL,
	"sample_rate_hz" smallint NOT NULL,
	"format_version" smallint NOT NULL,
	"byte_size" integer NOT NULL,
	"payload" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"client_set_id" uuid NOT NULL,
	"mode" text NOT NULL,
	"pause_mode" text,
	"pause_fixed_ms" integer,
	"pause_min_ms" integer,
	"pause_max_ms" integer,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone NOT NULL,
	"weight_kg" numeric(5, 1),
	"rpe" numeric(3, 1),
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "sets_device_id_client_set_id_key" UNIQUE("device_id","client_set_id"),
	CONSTRAINT "sets_mode_check" CHECK ("sets"."mode" IN ('auto_signal', 'count_only')),
	CONSTRAINT "sets_pause_check" CHECK ((
  "sets"."mode" = 'count_only'
  AND "sets"."pause_mode" IS NULL AND "sets"."pause_fixed_ms" IS NULL
  AND "sets"."pause_min_ms" IS NULL AND "sets"."pause_max_ms" IS NULL
) OR (
  "sets"."mode" = 'auto_signal' AND "sets"."pause_mode" = 'fixed'
  AND "sets"."pause_fixed_ms" IS NOT NULL
  AND "sets"."pause_min_ms" IS NULL AND "sets"."pause_max_ms" IS NULL
) OR (
  "sets"."mode" = 'auto_signal' AND "sets"."pause_mode" = 'random'
  AND "sets"."pause_fixed_ms" IS NULL
  AND "sets"."pause_min_ms" IS NOT NULL AND "sets"."pause_max_ms" IS NOT NULL
  AND "sets"."pause_min_ms" <= "sets"."pause_max_ms"
)),
	CONSTRAINT "sets_time_order_check" CHECK ("sets"."started_at" <= "sets"."ended_at"),
	CONSTRAINT "sets_weight_kg_check" CHECK ("sets"."weight_kg" BETWEEN 0 AND 500),
	CONSTRAINT "sets_rpe_check" CHECK ("sets"."rpe" BETWEEN 1 AND 10)
);
--> statement-breakpoint
CREATE TABLE "training_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"session_date" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "training_sessions_user_id_session_date_key" UNIQUE("user_id","session_date")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"display_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "device_authorizations" ADD CONSTRAINT "device_authorizations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_authorizations" ADD CONSTRAINT "device_authorizations_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_settings" ADD CONSTRAINT "device_settings_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_tokens" ADD CONSTRAINT "device_tokens_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_accounts" ADD CONSTRAINT "oauth_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reps" ADD CONSTRAINT "reps_set_id_sets_id_fk" FOREIGN KEY ("set_id") REFERENCES "public"."sets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "set_raw_data" ADD CONSTRAINT "set_raw_data_set_id_sets_id_fk" FOREIGN KEY ("set_id") REFERENCES "public"."sets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sets" ADD CONSTRAINT "sets_session_id_training_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."training_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sets" ADD CONSTRAINT "sets_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_sessions" ADD CONSTRAINT "training_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "devices_user_id_idx" ON "devices" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "refresh_tokens_family_id_idx" ON "refresh_tokens" USING btree ("family_id");--> statement-breakpoint
CREATE INDEX "sets_session_id_idx" ON "sets" USING btree ("session_id");