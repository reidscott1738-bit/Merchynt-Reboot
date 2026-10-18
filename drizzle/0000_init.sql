CREATE TABLE "activity_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"business_id" uuid,
	"actor_type" text NOT NULL,
	"actor_id" text,
	"action" text NOT NULL,
	"target_type" text,
	"target_id" text,
	"detail" jsonb,
	"ip" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_visibility_audits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"providers" text[] NOT NULL,
	"template_version" text NOT NULL,
	"trigger" text DEFAULT 'manual' NOT NULL,
	"stats" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "ai_visibility_queries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"audit_id" uuid NOT NULL,
	"business_id" uuid NOT NULL,
	"keyword_id" uuid,
	"keyword" text NOT NULL,
	"city" text,
	"query_text" text NOT NULL,
	"provider" text NOT NULL,
	"model" text,
	"status" text DEFAULT 'queued' NOT NULL,
	"response_text" text,
	"sources" jsonb,
	"mentioned_businesses" jsonb,
	"mentioned" boolean,
	"position" integer,
	"error" text,
	"is_demo" boolean DEFAULT false NOT NULL,
	"ran_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "approval_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"recipient_email" text NOT NULL,
	"allowed_actions" text[] NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_configurations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"keyword_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"center_lat" double precision NOT NULL,
	"center_lng" double precision NOT NULL,
	"radius_km" double precision NOT NULL,
	"grid_size" integer NOT NULL,
	"device" text DEFAULT 'mobile' NOT NULL,
	"language" text DEFAULT 'en' NOT NULL,
	"provider" text NOT NULL,
	"is_current" boolean DEFAULT true NOT NULL,
	"change_note" text,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "automation_executions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rule_id" uuid NOT NULL,
	"business_id" uuid NOT NULL,
	"trigger" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"scheduled_for" timestamp with time zone NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"summary" jsonb,
	"error" text,
	"idempotency_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "automation_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"type" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"schedule" jsonb NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"approval_mode" text DEFAULT 'all' NOT NULL,
	"notification_recipients" text[] DEFAULT '{}'::text[] NOT NULL,
	"show_tasks_in_dashboard" boolean DEFAULT true NOT NULL,
	"max_retries" integer DEFAULT 3 NOT NULL,
	"last_run_at" timestamp with time zone,
	"next_run_at" timestamp with time zone,
	"last_success_at" timestamp with time zone,
	"last_failure_at" timestamp with time zone,
	"last_error" text,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"updated_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "business_attributes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"attribute_key" text NOT NULL,
	"display_name" text NOT NULL,
	"group_name" text,
	"value" jsonb,
	"is_factual_claim" boolean DEFAULT true NOT NULL,
	"status" text DEFAULT 'suggested' NOT NULL,
	"source" text NOT NULL,
	"confirmed_by_user_id" uuid,
	"confirmed_at" timestamp with time zone,
	"sync_status" text DEFAULT 'local_only' NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "business_knowledge" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"category" text NOT NULL,
	"key" text NOT NULL,
	"value" text NOT NULL,
	"source" text NOT NULL,
	"source_ref" text,
	"evidence" text,
	"verification_status" text DEFAULT 'unverified' NOT NULL,
	"is_public" boolean DEFAULT true NOT NULL,
	"requires_confirmation" boolean DEFAULT false NOT NULL,
	"verified_by_user_id" uuid,
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "business_locations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"client_id" uuid,
	"name" text NOT NULL,
	"website" text,
	"primary_category" text,
	"secondary_categories" text[] DEFAULT '{}'::text[] NOT NULL,
	"description" text,
	"phone" text,
	"email" text,
	"appointment_url" text,
	"address_line1" text,
	"address_line2" text,
	"city" text,
	"region" text,
	"postal_code" text,
	"country" text DEFAULT 'US',
	"latitude" double precision,
	"longitude" double precision,
	"is_service_area_business" boolean DEFAULT false NOT NULL,
	"hide_address" boolean DEFAULT false NOT NULL,
	"service_area" jsonb,
	"hours" jsonb,
	"special_hours" jsonb,
	"timezone" text DEFAULT 'America/Chicago' NOT NULL,
	"logo_asset_id" uuid,
	"brand" jsonb,
	"average_customer_value" numeric(12, 2),
	"review_slug" text NOT NULL,
	"google_review_url" text,
	"gbp_location_name" text,
	"google_place_id" text,
	"gbp_account_name" text,
	"google_integration_id" uuid,
	"onboarding" jsonb DEFAULT '{"steps":{}}'::jsonb NOT NULL,
	"onboarding_completed_at" timestamp with time zone,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "business_services" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"name" text NOT NULL,
	"category" text,
	"description" text,
	"source" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"sync_status" text DEFAULT 'local_only' NOT NULL,
	"last_synced_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campaign_contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"business_id" uuid NOT NULL,
	"name" text,
	"email" text,
	"email_normalized" text,
	"phone" text,
	"service_label" text,
	"salesperson" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"validation_errors" text[],
	"sends" integer DEFAULT 0 NOT NULL,
	"enrolled_at" timestamp with time zone,
	"last_sent_at" timestamp with time zone,
	"next_send_at" timestamp with time zone,
	"clicked_at" timestamp with time zone,
	"opt_out_token" text NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "clients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"contact_name" text,
	"contact_email" text,
	"status" text DEFAULT 'active' NOT NULL,
	"notes" text,
	"offboarded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "competitor_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"competitor_id" uuid NOT NULL,
	"audit_id" uuid,
	"keyword_id" uuid,
	"appearances" integer DEFAULT 0 NOT NULL,
	"average_rank" double precision,
	"top3_count" integer DEFAULT 0 NOT NULL,
	"rating" double precision,
	"review_count" integer,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "competitors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"place_id" text NOT NULL,
	"name" text NOT NULL,
	"address" text,
	"is_tracked" boolean DEFAULT false NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "connection_invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"client_id" uuid,
	"business_id" uuid,
	"provider" text NOT NULL,
	"token_hash" text NOT NULL,
	"recipient_email" text,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"outcome" text,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "content_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"type" text NOT NULL,
	"title" text,
	"body" text NOT NULL,
	"cta_type" text,
	"cta_url" text,
	"media_asset_id" uuid,
	"image_mode" text DEFAULT 'none' NOT NULL,
	"branding" jsonb,
	"image_source" text DEFAULT 'none' NOT NULL,
	"destinations" text[] DEFAULT '{google}'::text[] NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"scheduled_for" timestamp with time zone,
	"approval_required" boolean DEFAULT false NOT NULL,
	"approval_reason" text,
	"holiday" text,
	"content_hash" text NOT NULL,
	"validation" jsonb,
	"generation" jsonb,
	"automation_execution_id" uuid,
	"task_id" uuid,
	"created_by_user_id" uuid,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "credit_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"delta" integer NOT NULL,
	"reason" text NOT NULL,
	"report_id" uuid,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "custom_domains" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"hostname" text NOT NULL,
	"purpose" text NOT NULL,
	"website_id" uuid,
	"verification_token" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"last_checked_at" timestamp with time zone,
	"last_check" jsonb,
	"last_error" text,
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid,
	"to" text NOT NULL,
	"from_name" text,
	"from_email" text,
	"subject" text NOT NULL,
	"html" text NOT NULL,
	"text" text NOT NULL,
	"template" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"provider" text,
	"provider_message_id" text,
	"error" text,
	"related_type" text,
	"related_id" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "faqs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"question" text NOT NULL,
	"answer" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"source_fact_ids" uuid[],
	"validation" jsonb,
	"question_hash" text NOT NULL,
	"task_id" uuid,
	"published_at" timestamp with time zone,
	"stale_since" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "integration_targets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"integration_id" uuid NOT NULL,
	"target_type" text NOT NULL,
	"external_id" text NOT NULL,
	"external_name" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"last_publish_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "integrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"client_id" uuid,
	"provider" text NOT NULL,
	"external_account_id" text NOT NULL,
	"external_account_name" text,
	"scopes" text[] DEFAULT '{}'::text[] NOT NULL,
	"access_token_enc" text,
	"refresh_token_enc" text,
	"token_expires_at" timestamp with time zone,
	"status" text DEFAULT 'active' NOT NULL,
	"last_error" text,
	"last_health_check_at" timestamp with time zone,
	"last_success_at" timestamp with time zone,
	"connected_by_user_id" uuid,
	"connected_via" text DEFAULT 'user' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"email" text NOT NULL,
	"role" text NOT NULL,
	"client_ids" uuid[],
	"token_hash" text NOT NULL,
	"invited_by_user_id" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"queue" text DEFAULT 'default' NOT NULL,
	"name" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"run_at" timestamp with time zone DEFAULT now() NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"backoff_base_ms" integer DEFAULT 30000 NOT NULL,
	"timeout_ms" integer DEFAULT 300000 NOT NULL,
	"locked_by" text,
	"locked_at" timestamp with time zone,
	"last_error" text,
	"result" jsonb,
	"idempotency_key" text,
	"org_id" uuid,
	"business_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "keyword_demand_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"keyword_id" uuid NOT NULL,
	"estimate" integer,
	"source" text NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"observed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "keywords" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"phrase" text NOT NULL,
	"normalized" text NOT NULL,
	"intent" text DEFAULT 'discovery' NOT NULL,
	"service_id" uuid,
	"city" text,
	"priority" integer DEFAULT 3 NOT NULL,
	"is_tracked" boolean DEFAULT true NOT NULL,
	"source" text DEFAULT 'user' NOT NULL,
	"demand_estimate" integer,
	"demand_source" text,
	"demand_as_of" timestamp with time zone,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "media_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"source" text NOT NULL,
	"storage_key" text NOT NULL,
	"mime" text NOT NULL,
	"bytes" integer NOT NULL,
	"width" integer,
	"height" integer,
	"duration_ms" integer,
	"sha256" text NOT NULL,
	"perceptual_hash" text,
	"original_filename" text,
	"seo_filename" text,
	"alt_text" text,
	"description" text,
	"description_source" text DEFAULT 'none' NOT NULL,
	"exif_lat" double precision,
	"exif_lng" double precision,
	"exif_taken_at" timestamp with time zone,
	"exif" jsonb,
	"assoc_label" text,
	"assoc_lat" double precision,
	"assoc_lng" double precision,
	"uploaded_by_user_id" uuid,
	"contributor_name" text,
	"contributor_email" text,
	"consent" jsonb,
	"attribution" text,
	"external_ref" text,
	"moderation_status" text DEFAULT 'approved' NOT NULL,
	"moderation_notes" text,
	"use_for_posts" boolean DEFAULT true NOT NULL,
	"use_for_website" boolean DEFAULT true NOT NULL,
	"use_for_videos" boolean DEFAULT true NOT NULL,
	"use_for_google_media" boolean DEFAULT true NOT NULL,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"is_ai_generated" boolean DEFAULT false NOT NULL,
	"parent_asset_id" uuid,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "media_usages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"asset_id" uuid NOT NULL,
	"business_id" uuid NOT NULL,
	"usage_type" text NOT NULL,
	"ref_id" uuid,
	"used_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "media_variants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"asset_id" uuid NOT NULL,
	"variant" text NOT NULL,
	"storage_key" text NOT NULL,
	"mime" text NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"bytes" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text NOT NULL,
	"client_ids" uuid[],
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_preferences" (
	"user_id" uuid NOT NULL,
	"org_id" uuid NOT NULL,
	"prefs" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_preferences_user_id_org_id_pk" PRIMARY KEY("user_id","org_id")
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"business_id" uuid,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"link" text,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "oauth_states" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"user_id" uuid,
	"provider" text NOT NULL,
	"business_id" uuid,
	"connection_invite_id" uuid,
	"code_verifier" text,
	"redirect_to" text,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "optimization_scores" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"score" integer NOT NULL,
	"breakdown" jsonb NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organization_branding" (
	"org_id" uuid PRIMARY KEY NOT NULL,
	"display_name" text,
	"logo_url" text,
	"primary_color" text,
	"secondary_color" text,
	"support_email" text,
	"support_url" text,
	"sender_name" text,
	"sender_email" text,
	"sender_verified_at" timestamp with time zone,
	"report_footer" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"kind" text DEFAULT 'business' NOT NULL,
	"plan" text DEFAULT 'standard' NOT NULL,
	"limits" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "performance_metrics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"metric" text NOT NULL,
	"date" date NOT NULL,
	"value" integer NOT NULL,
	"source" text NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "profile_changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"field" text NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"origin" text NOT NULL,
	"actor_user_id" uuid,
	"sync_status" text DEFAULT 'local_only' NOT NULL,
	"synced_at" timestamp with time zone,
	"sync_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "profile_recommendations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"field" text NOT NULL,
	"issue" text NOT NULL,
	"current_value" jsonb,
	"proposed_value" jsonb,
	"reason" text NOT NULL,
	"impact" text NOT NULL,
	"confidence" double precision NOT NULL,
	"auto_applicable" boolean DEFAULT false NOT NULL,
	"requires_fact_confirmation" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"next_action" text,
	"task_id" uuid,
	"apply_result" jsonb,
	"applied_at" timestamp with time zone,
	"generation" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "publication_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"ref_type" text NOT NULL,
	"ref_id" uuid NOT NULL,
	"destination" text NOT NULL,
	"target_id" uuid,
	"requested_for" timestamp with time zone NOT NULL,
	"last_attempt_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"idempotency_key" text NOT NULL,
	"provider_id" text,
	"provider_url" text,
	"provider_response" jsonb,
	"last_error" text,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ranking_audits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"configuration_id" uuid NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"provider" text NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"trigger" text DEFAULT 'manual' NOT NULL,
	"points_total" integer DEFAULT 0 NOT NULL,
	"points_succeeded" integer DEFAULT 0 NOT NULL,
	"stats" jsonb,
	"error" text,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ranking_observations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"audit_id" uuid NOT NULL,
	"point_index" integer NOT NULL,
	"lat" double precision NOT NULL,
	"lng" double precision NOT NULL,
	"status" text NOT NULL,
	"rank" integer,
	"matched_place_id" text,
	"results" jsonb,
	"error" text,
	"provider_ref" text,
	"observed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rate_limits" (
	"key" text PRIMARY KEY NOT NULL,
	"count" integer NOT NULL,
	"window_start" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "report_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"report_id" uuid NOT NULL,
	"recipient" text NOT NULL,
	"status" text NOT NULL,
	"email_message_id" uuid,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"business_id" uuid NOT NULL,
	"type" text NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"data" jsonb,
	"narrative" text,
	"html" text,
	"error" text,
	"credits_charged" integer DEFAULT 0 NOT NULL,
	"requested_by_user_id" uuid,
	"generated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "review_campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"channel" text DEFAULT 'email' NOT NULL,
	"subject" text NOT NULL,
	"message_template" text NOT NULL,
	"follow_up" jsonb NOT NULL,
	"daily_limit" integer DEFAULT 50 NOT NULL,
	"send_window" jsonb NOT NULL,
	"start_at" timestamp with time zone,
	"link_id" uuid,
	"created_by_user_id" uuid,
	"paused_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "review_link_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"link_id" uuid,
	"business_id" uuid NOT NULL,
	"contact_id" uuid,
	"type" text NOT NULL,
	"meta" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "review_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"label" text NOT NULL,
	"salesperson" text,
	"service" text,
	"campaign_id" uuid,
	"photo_boost_enabled" boolean DEFAULT true NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "review_policies" (
	"business_id" uuid NOT NULL,
	"rating" integer NOT NULL,
	"mode" text NOT NULL,
	"template_id" uuid,
	"template_requires_approval" boolean DEFAULT false NOT NULL,
	"escalate" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "review_policies_business_id_rating_pk" PRIMARY KEY("business_id","rating")
);
--> statement-breakpoint
CREATE TABLE "review_replies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"review_id" uuid NOT NULL,
	"business_id" uuid NOT NULL,
	"content" text NOT NULL,
	"origin" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"validation" jsonb,
	"generation" jsonb,
	"task_id" uuid,
	"publication_job_id" uuid,
	"published_at" timestamp with time zone,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "review_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"review_id" uuid NOT NULL,
	"business_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"evidence" text,
	"detected_signals" jsonb,
	"status" text DEFAULT 'draft' NOT NULL,
	"submission_method" text,
	"submitted_at" timestamp with time zone,
	"submitted_by_user_id" uuid,
	"outcome_at" timestamp with time zone,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "review_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"name" text NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"source" text NOT NULL,
	"external_id" text NOT NULL,
	"reviewer_name" text,
	"rating" integer NOT NULL,
	"text" text,
	"published_at" timestamp with time zone NOT NULL,
	"owner_reply" text,
	"owner_reply_at" timestamp with time zone,
	"reply_status" text DEFAULT 'unanswered' NOT NULL,
	"policy_applied" text,
	"sentiment" text,
	"analysis" jsonb,
	"is_demo" boolean DEFAULT false NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "schema_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"json_ld" jsonb NOT NULL,
	"validation" jsonb NOT NULL,
	"is_current" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "seo_audits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"url" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"extracted" jsonb,
	"http_status" integer,
	"error" text,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "seo_recommendations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"audit_id" uuid NOT NULL,
	"business_id" uuid NOT NULL,
	"element" text NOT NULL,
	"current_value" text,
	"recommended_value" text,
	"status" text NOT NULL,
	"basis" text NOT NULL,
	"explanation" text NOT NULL,
	"confidence" double precision NOT NULL,
	"instructions" text,
	"applied_at" timestamp with time zone,
	"rechecked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"active_org_id" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"ip" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "suppressions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"business_id" uuid,
	"email_normalized" text NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"action" text NOT NULL,
	"actor_type" text NOT NULL,
	"actor_id" text,
	"detail" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"business_id" uuid NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"summary" text,
	"ref_type" text NOT NULL,
	"ref_id" uuid NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"kind" text DEFAULT 'approval' NOT NULL,
	"assignee_user_id" uuid,
	"assignee_email" text,
	"notification_recipients" text[] DEFAULT '{}'::text[] NOT NULL,
	"visible_in_dashboard" boolean DEFAULT true NOT NULL,
	"client_can_approve" boolean DEFAULT true NOT NULL,
	"due_at" timestamp with time zone,
	"created_by" text DEFAULT 'system' NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolved_by" text,
	"resolution_note" text,
	"outcome" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "training_instructions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"category" text NOT NULL,
	"version" integer NOT NULL,
	"content" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "upload_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"label" text NOT NULL,
	"require_approval" boolean DEFAULT true NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"uploads_count" integer DEFAULT 0 NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "usage_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"business_id" uuid,
	"metric" text NOT NULL,
	"quantity" integer NOT NULL,
	"provider" text,
	"detail" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"password_hash" text,
	"google_subject" text,
	"email_verified_at" timestamp with time zone,
	"is_platform_admin" boolean DEFAULT false NOT NULL,
	"deactivated_at" timestamp with time zone,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "video_projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"title" text NOT NULL,
	"format" text DEFAULT 'vertical' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"settings" jsonb NOT NULL,
	"brief" text,
	"destinations" text[] DEFAULT '{}'::text[] NOT NULL,
	"output_asset_id" uuid,
	"preview_asset_id" uuid,
	"rendered_revision" integer,
	"revision" integer DEFAULT 1 NOT NULL,
	"render_error" text,
	"render_log" jsonb,
	"task_id" uuid,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "video_scenes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"media_asset_id" uuid,
	"is_b_roll" boolean DEFAULT false NOT NULL,
	"narration" text DEFAULT '' NOT NULL,
	"voice_id" text,
	"delivery_instruction" text,
	"pronunciation_overrides" jsonb,
	"overlay_text" text,
	"duration_ms" integer DEFAULT 4000 NOT NULL,
	"transition" text DEFAULT 'fade' NOT NULL,
	"effect" text DEFAULT 'zoom_in' NOT NULL,
	"audio_asset_id" uuid,
	"audio_hash" text,
	"segment_asset_id" uuid,
	"segment_hash" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "website_deployments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"website_id" uuid NOT NULL,
	"revision_id" uuid NOT NULL,
	"status" text NOT NULL,
	"checks" jsonb,
	"url" text,
	"error" text,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "website_pages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"website_id" uuid NOT NULL,
	"path" text NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"nav_label" text NOT NULL,
	"meta_title" text,
	"meta_description" text,
	"canonical_url" text,
	"noindex" boolean DEFAULT false NOT NULL,
	"sections" jsonb NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "website_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"website_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"snapshot" jsonb NOT NULL,
	"note" text,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "websites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"theme" jsonb NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"published_revision_id" uuid,
	"published_at" timestamp with time zone,
	"custom_domain_id" uuid,
	"settings" jsonb NOT NULL,
	"generation_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_visibility_audits" ADD CONSTRAINT "ai_visibility_audits_business_id_business_locations_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business_locations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_visibility_queries" ADD CONSTRAINT "ai_visibility_queries_audit_id_ai_visibility_audits_id_fk" FOREIGN KEY ("audit_id") REFERENCES "public"."ai_visibility_audits"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_visibility_queries" ADD CONSTRAINT "ai_visibility_queries_business_id_business_locations_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business_locations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_visibility_queries" ADD CONSTRAINT "ai_visibility_queries_keyword_id_keywords_id_fk" FOREIGN KEY ("keyword_id") REFERENCES "public"."keywords"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_tokens" ADD CONSTRAINT "approval_tokens_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_configurations" ADD CONSTRAINT "audit_configurations_business_id_business_locations_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business_locations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_configurations" ADD CONSTRAINT "audit_configurations_keyword_id_keywords_id_fk" FOREIGN KEY ("keyword_id") REFERENCES "public"."keywords"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_executions" ADD CONSTRAINT "automation_executions_rule_id_automation_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."automation_rules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_executions" ADD CONSTRAINT "automation_executions_business_id_business_locations_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business_locations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_rules" ADD CONSTRAINT "automation_rules_business_id_business_locations_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business_locations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_attributes" ADD CONSTRAINT "business_attributes_business_id_business_locations_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business_locations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_knowledge" ADD CONSTRAINT "business_knowledge_business_id_business_locations_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business_locations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_locations" ADD CONSTRAINT "business_locations_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_locations" ADD CONSTRAINT "business_locations_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_services" ADD CONSTRAINT "business_services_business_id_business_locations_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business_locations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_contacts" ADD CONSTRAINT "campaign_contacts_campaign_id_review_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."review_campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_contacts" ADD CONSTRAINT "campaign_contacts_business_id_business_locations_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business_locations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clients" ADD CONSTRAINT "clients_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competitor_snapshots" ADD CONSTRAINT "competitor_snapshots_competitor_id_competitors_id_fk" FOREIGN KEY ("competitor_id") REFERENCES "public"."competitors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competitor_snapshots" ADD CONSTRAINT "competitor_snapshots_audit_id_ranking_audits_id_fk" FOREIGN KEY ("audit_id") REFERENCES "public"."ranking_audits"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competitor_snapshots" ADD CONSTRAINT "competitor_snapshots_keyword_id_keywords_id_fk" FOREIGN KEY ("keyword_id") REFERENCES "public"."keywords"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competitors" ADD CONSTRAINT "competitors_business_id_business_locations_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business_locations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connection_invites" ADD CONSTRAINT "connection_invites_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connection_invites" ADD CONSTRAINT "connection_invites_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connection_invites" ADD CONSTRAINT "connection_invites_business_id_business_locations_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business_locations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_items" ADD CONSTRAINT "content_items_business_id_business_locations_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business_locations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_ledger" ADD CONSTRAINT "credit_ledger_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_domains" ADD CONSTRAINT "custom_domains_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "faqs" ADD CONSTRAINT "faqs_business_id_business_locations_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business_locations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_targets" ADD CONSTRAINT "integration_targets_business_id_business_locations_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business_locations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_targets" ADD CONSTRAINT "integration_targets_integration_id_integrations_id_fk" FOREIGN KEY ("integration_id") REFERENCES "public"."integrations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integrations" ADD CONSTRAINT "integrations_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integrations" ADD CONSTRAINT "integrations_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_invited_by_user_id_users_id_fk" FOREIGN KEY ("invited_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "keyword_demand_history" ADD CONSTRAINT "keyword_demand_history_keyword_id_keywords_id_fk" FOREIGN KEY ("keyword_id") REFERENCES "public"."keywords"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "keywords" ADD CONSTRAINT "keywords_business_id_business_locations_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business_locations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "keywords" ADD CONSTRAINT "keywords_service_id_business_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."business_services"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_business_id_business_locations_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business_locations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_usages" ADD CONSTRAINT "media_usages_asset_id_media_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."media_assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_usages" ADD CONSTRAINT "media_usages_business_id_business_locations_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business_locations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_variants" ADD CONSTRAINT "media_variants_asset_id_media_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."media_assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "optimization_scores" ADD CONSTRAINT "optimization_scores_business_id_business_locations_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business_locations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_branding" ADD CONSTRAINT "organization_branding_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "performance_metrics" ADD CONSTRAINT "performance_metrics_business_id_business_locations_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business_locations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_changes" ADD CONSTRAINT "profile_changes_business_id_business_locations_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business_locations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_recommendations" ADD CONSTRAINT "profile_recommendations_business_id_business_locations_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business_locations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publication_jobs" ADD CONSTRAINT "publication_jobs_business_id_business_locations_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business_locations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ranking_audits" ADD CONSTRAINT "ranking_audits_business_id_business_locations_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business_locations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ranking_audits" ADD CONSTRAINT "ranking_audits_configuration_id_audit_configurations_id_fk" FOREIGN KEY ("configuration_id") REFERENCES "public"."audit_configurations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ranking_observations" ADD CONSTRAINT "ranking_observations_audit_id_ranking_audits_id_fk" FOREIGN KEY ("audit_id") REFERENCES "public"."ranking_audits"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_deliveries" ADD CONSTRAINT "report_deliveries_report_id_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."reports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_business_id_business_locations_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business_locations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_campaigns" ADD CONSTRAINT "review_campaigns_business_id_business_locations_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business_locations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_link_events" ADD CONSTRAINT "review_link_events_link_id_review_links_id_fk" FOREIGN KEY ("link_id") REFERENCES "public"."review_links"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_link_events" ADD CONSTRAINT "review_link_events_business_id_business_locations_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business_locations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_links" ADD CONSTRAINT "review_links_business_id_business_locations_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business_locations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_policies" ADD CONSTRAINT "review_policies_business_id_business_locations_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business_locations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_replies" ADD CONSTRAINT "review_replies_review_id_reviews_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."reviews"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_replies" ADD CONSTRAINT "review_replies_business_id_business_locations_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business_locations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_reports" ADD CONSTRAINT "review_reports_review_id_reviews_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."reviews"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_reports" ADD CONSTRAINT "review_reports_business_id_business_locations_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business_locations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_templates" ADD CONSTRAINT "review_templates_business_id_business_locations_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business_locations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_business_id_business_locations_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business_locations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schema_documents" ADD CONSTRAINT "schema_documents_business_id_business_locations_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business_locations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seo_audits" ADD CONSTRAINT "seo_audits_business_id_business_locations_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business_locations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seo_recommendations" ADD CONSTRAINT "seo_recommendations_audit_id_seo_audits_id_fk" FOREIGN KEY ("audit_id") REFERENCES "public"."seo_audits"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seo_recommendations" ADD CONSTRAINT "seo_recommendations_business_id_business_locations_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business_locations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suppressions" ADD CONSTRAINT "suppressions_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suppressions" ADD CONSTRAINT "suppressions_business_id_business_locations_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business_locations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_events" ADD CONSTRAINT "task_events_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_business_id_business_locations_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business_locations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_instructions" ADD CONSTRAINT "training_instructions_business_id_business_locations_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business_locations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upload_links" ADD CONSTRAINT "upload_links_business_id_business_locations_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business_locations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_projects" ADD CONSTRAINT "video_projects_business_id_business_locations_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business_locations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_scenes" ADD CONSTRAINT "video_scenes_project_id_video_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."video_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "website_deployments" ADD CONSTRAINT "website_deployments_website_id_websites_id_fk" FOREIGN KEY ("website_id") REFERENCES "public"."websites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "website_deployments" ADD CONSTRAINT "website_deployments_revision_id_website_revisions_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."website_revisions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "website_pages" ADD CONSTRAINT "website_pages_website_id_websites_id_fk" FOREIGN KEY ("website_id") REFERENCES "public"."websites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "website_revisions" ADD CONSTRAINT "website_revisions_website_id_websites_id_fk" FOREIGN KEY ("website_id") REFERENCES "public"."websites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "websites" ADD CONSTRAINT "websites_business_id_business_locations_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business_locations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activity_org_idx" ON "activity_events" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE INDEX "activity_business_idx" ON "activity_events" USING btree ("business_id","created_at");--> statement-breakpoint
CREATE INDEX "ai_vis_queries_audit_idx" ON "ai_visibility_queries" USING btree ("audit_id");--> statement-breakpoint
CREATE UNIQUE INDEX "approval_tokens_hash_uq" ON "approval_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "approval_tokens_task_idx" ON "approval_tokens" USING btree ("task_id");--> statement-breakpoint
CREATE UNIQUE INDEX "audit_config_keyword_version_uq" ON "audit_configurations" USING btree ("keyword_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "automation_exec_idem_uq" ON "automation_executions" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "automation_exec_rule_idx" ON "automation_executions" USING btree ("rule_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "automation_rules_business_type_uq" ON "automation_rules" USING btree ("business_id","type");--> statement-breakpoint
CREATE INDEX "automation_rules_due_idx" ON "automation_rules" USING btree ("enabled","next_run_at");--> statement-breakpoint
CREATE UNIQUE INDEX "attributes_business_key_uq" ON "business_attributes" USING btree ("business_id","attribute_key");--> statement-breakpoint
CREATE INDEX "knowledge_business_idx" ON "business_knowledge" USING btree ("business_id");--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_business_key_uq" ON "business_knowledge" USING btree ("business_id","category","key");--> statement-breakpoint
CREATE INDEX "business_org_idx" ON "business_locations" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "business_client_idx" ON "business_locations" USING btree ("client_id");--> statement-breakpoint
CREATE UNIQUE INDEX "business_review_slug_uq" ON "business_locations" USING btree ("review_slug");--> statement-breakpoint
CREATE INDEX "services_business_idx" ON "business_services" USING btree ("business_id");--> statement-breakpoint
CREATE UNIQUE INDEX "campaign_contacts_email_uq" ON "campaign_contacts" USING btree ("campaign_id","email_normalized");--> statement-breakpoint
CREATE INDEX "campaign_contacts_due_idx" ON "campaign_contacts" USING btree ("campaign_id","status","next_send_at");--> statement-breakpoint
CREATE UNIQUE INDEX "campaign_contacts_optout_uq" ON "campaign_contacts" USING btree ("opt_out_token");--> statement-breakpoint
CREATE INDEX "clients_org_idx" ON "clients" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "competitors_business_place_uq" ON "competitors" USING btree ("business_id","place_id");--> statement-breakpoint
CREATE UNIQUE INDEX "connection_invites_token_uq" ON "connection_invites" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "content_business_status_idx" ON "content_items" USING btree ("business_id","type","status");--> statement-breakpoint
CREATE INDEX "content_scheduled_idx" ON "content_items" USING btree ("status","scheduled_for");--> statement-breakpoint
CREATE INDEX "credit_ledger_org_idx" ON "credit_ledger" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "custom_domains_hostname_uq" ON "custom_domains" USING btree ("hostname");--> statement-breakpoint
CREATE INDEX "custom_domains_org_idx" ON "custom_domains" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "email_messages_org_idx" ON "email_messages" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "faqs_business_qhash_uq" ON "faqs" USING btree ("business_id","question_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "targets_business_type_ext_uq" ON "integration_targets" USING btree ("business_id","target_type","external_id");--> statement-breakpoint
CREATE UNIQUE INDEX "integrations_org_provider_account_uq" ON "integrations" USING btree ("org_id","provider","external_account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "invitations_token_uq" ON "invitations" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "invitations_org_idx" ON "invitations" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "jobs_pending_idx" ON "jobs" USING btree ("queue","status","run_at");--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_idem_uq" ON "jobs" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "jobs_business_idx" ON "jobs" USING btree ("business_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "keywords_business_norm_city_uq" ON "keywords" USING btree ("business_id","normalized",coalesce("city", ''));--> statement-breakpoint
CREATE INDEX "media_business_idx" ON "media_assets" USING btree ("business_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "media_business_sha_uq" ON "media_assets" USING btree ("business_id","sha256");--> statement-breakpoint
CREATE INDEX "media_usages_asset_idx" ON "media_usages" USING btree ("asset_id","used_at");--> statement-breakpoint
CREATE UNIQUE INDEX "media_variant_uq" ON "media_variants" USING btree ("asset_id","variant");--> statement-breakpoint
CREATE UNIQUE INDEX "memberships_org_user_uq" ON "memberships" USING btree ("org_id","user_id");--> statement-breakpoint
CREATE INDEX "memberships_user_idx" ON "memberships" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "notifications_user_idx" ON "notifications" USING btree ("user_id","read_at");--> statement-breakpoint
CREATE UNIQUE INDEX "organizations_slug_uq" ON "organizations" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "perf_metrics_uq" ON "performance_metrics" USING btree ("business_id","metric","date","source");--> statement-breakpoint
CREATE INDEX "profile_changes_business_idx" ON "profile_changes" USING btree ("business_id","created_at");--> statement-breakpoint
CREATE INDEX "profile_recs_business_idx" ON "profile_recommendations" USING btree ("business_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "publication_jobs_idem_uq" ON "publication_jobs" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "publication_jobs_ref_idx" ON "publication_jobs" USING btree ("ref_type","ref_id");--> statement-breakpoint
CREATE INDEX "ranking_audits_business_idx" ON "ranking_audits" USING btree ("business_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "ranking_obs_audit_point_uq" ON "ranking_observations" USING btree ("audit_id","point_index");--> statement-breakpoint
CREATE INDEX "reports_business_idx" ON "reports" USING btree ("business_id","created_at");--> statement-breakpoint
CREATE INDEX "review_link_events_business_idx" ON "review_link_events" USING btree ("business_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "review_links_business_slug_uq" ON "review_links" USING btree ("business_id","slug");--> statement-breakpoint
CREATE INDEX "review_replies_review_idx" ON "review_replies" USING btree ("review_id");--> statement-breakpoint
CREATE UNIQUE INDEX "reviews_business_source_ext_uq" ON "reviews" USING btree ("business_id","source","external_id");--> statement-breakpoint
CREATE INDEX "reviews_business_published_idx" ON "reviews" USING btree ("business_id","published_at");--> statement-breakpoint
CREATE INDEX "seo_recs_business_idx" ON "seo_recommendations" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "suppressions_org_email_uq" ON "suppressions" USING btree ("org_id","email_normalized");--> statement-breakpoint
CREATE INDEX "task_events_task_idx" ON "task_events" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "tasks_org_status_idx" ON "tasks" USING btree ("org_id","status");--> statement-breakpoint
CREATE INDEX "tasks_business_idx" ON "tasks" USING btree ("business_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "tasks_open_ref_uq" ON "tasks" USING btree ("ref_type","ref_id") WHERE status = 'open';--> statement-breakpoint
CREATE UNIQUE INDEX "training_business_cat_ver_uq" ON "training_instructions" USING btree ("business_id","category","version");--> statement-breakpoint
CREATE UNIQUE INDEX "upload_links_token_uq" ON "upload_links" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "usage_org_metric_idx" ON "usage_records" USING btree ("org_id","metric","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_uq" ON "users" USING btree (lower("email"));--> statement-breakpoint
CREATE UNIQUE INDEX "users_google_sub_uq" ON "users" USING btree ("google_subject");--> statement-breakpoint
CREATE INDEX "video_scenes_project_idx" ON "video_scenes" USING btree ("project_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "website_pages_path_uq" ON "website_pages" USING btree ("website_id","path");--> statement-breakpoint
CREATE UNIQUE INDEX "website_revisions_number_uq" ON "website_revisions" USING btree ("website_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "websites_slug_uq" ON "websites" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "websites_business_idx" ON "websites" USING btree ("business_id");