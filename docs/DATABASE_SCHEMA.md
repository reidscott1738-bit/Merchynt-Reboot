# Database schema

PostgreSQL, managed with Drizzle. The source of truth is `src/server/db/schema.ts`; migrations are in `drizzle/`. The reference below is generated from a migrated database (71 tables in `public`), so it matches what the migrations create.

This schema is LocalPilot's own design. Paige's internal database structure is not public and was not reproduced.

## Rules every table follows

- **Tenancy.** Every business-owned row carries `org_id`, and most carry `business_id`. Services always filter by the actor's organization (and client scope for client approvers). Deleting an organization or business cascades to its data.
- **Honesty.** Rows that can come from a demo adapter (`reviews`, `publication_jobs`, `ranking_audits`, `competitors`, `keyword_demand_history`, `ai_visibility_queries`, `performance_metrics`) have an `is_demo` flag. Demo publications never have a `provider_id` or `provider_url`. Public websites and structured data exclude demo rows.
- **Provenance.** Facts (`business_knowledge`) record a source and whether a person verified them. Metrics record their source and period. Estimates store the assumption used.
- **Secrets.** OAuth access and refresh tokens are stored only in encrypted columns (`*_enc`, AES-256-GCM). Session ids, approval tokens, invite and upload tokens are stored as SHA-256 hashes, never in plain text.
- **History.** Ranking audits store their configuration version and each grid point. Website publishes are immutable deployments. Profile changes store before and after values. `activity_events` is the audit log.
- **Idempotency.** `jobs.idempotency_key` and `publication_jobs.idempotency_key` are unique, so retries and double clicks cannot queue or publish the same thing twice. Report credits are charged inside the transaction that creates the report, under a per-organization advisory lock, so concurrent requests cannot overspend (tested); a report that fails to generate is refunded.

## Identity and tenancy


### `users`

| Column | Type | Null | Default / reference |
|---|---|---|---|
| `id` | uuid |  | `gen_random_uuid()` |
| `email` | text |  |  |
| `name` | text |  |  |
| `password_hash` | text | yes |  |
| `google_subject` | text | yes |  |
| `email_verified_at` | timestamp with time zone | yes |  |
| `is_platform_admin` | boolean |  | `false` |
| `deactivated_at` | timestamp with time zone | yes |  |
| `last_login_at` | timestamp with time zone | yes |  |
| `created_at` | timestamp with time zone |  | `now()` |
| `updated_at` | timestamp with time zone |  | `now()` |

Indexes: `UNIQUE INDEX users_email_uq (lower(email))`; `UNIQUE INDEX users_google_sub_uq (google_subject)`

### `sessions`

| Column | Type | Null | Default / reference |
|---|---|---|---|
| `id` | text |  |  |
| `user_id` | uuid |  | → `users` (on delete cascade) |
| `active_org_id` | uuid | yes |  |
| `expires_at` | timestamp with time zone |  |  |
| `ip` | text | yes |  |
| `user_agent` | text | yes |  |
| `created_at` | timestamp with time zone |  | `now()` |

Indexes: `INDEX sessions_user_idx (user_id)`

### `organizations`

| Column | Type | Null | Default / reference |
|---|---|---|---|
| `id` | uuid |  | `gen_random_uuid()` |
| `name` | text |  |  |
| `slug` | text |  |  |
| `kind` | text |  | `'business'::text` |
| `plan` | text |  | `'standard'::text` |
| `limits` | jsonb |  | `'{}'::jsonb` |
| `status` | text |  | `'active'::text` |
| `created_at` | timestamp with time zone |  | `now()` |
| `updated_at` | timestamp with time zone |  | `now()` |

Indexes: `UNIQUE INDEX organizations_slug_uq (slug)`

### `clients`

| Column | Type | Null | Default / reference |
|---|---|---|---|
| `id` | uuid |  | `gen_random_uuid()` |
| `org_id` | uuid |  | → `organizations` (on delete cascade) |
| `name` | text |  |  |
| `contact_name` | text | yes |  |
| `contact_email` | text | yes |  |
| `status` | text |  | `'active'::text` |
| `notes` | text | yes |  |
| `offboarded_at` | timestamp with time zone | yes |  |
| `created_at` | timestamp with time zone |  | `now()` |
| `updated_at` | timestamp with time zone |  | `now()` |

Indexes: `INDEX clients_org_idx (org_id)`

### `memberships`

| Column | Type | Null | Default / reference |
|---|---|---|---|
| `id` | uuid |  | `gen_random_uuid()` |
| `org_id` | uuid |  | → `organizations` (on delete cascade) |
| `user_id` | uuid |  | → `users` (on delete cascade) |
| `role` | text |  |  |
| `client_ids` | _uuid | yes |  |
| `status` | text |  | `'active'::text` |
| `created_at` | timestamp with time zone |  | `now()` |
| `updated_at` | timestamp with time zone |  | `now()` |

Indexes: `UNIQUE INDEX memberships_org_user_uq (org_id, user_id)`; `INDEX memberships_user_idx (user_id)`

### `invitations`

| Column | Type | Null | Default / reference |
|---|---|---|---|
| `id` | uuid |  | `gen_random_uuid()` |
| `org_id` | uuid |  | → `organizations` (on delete cascade) |
| `email` | text |  |  |
| `role` | text |  |  |
| `client_ids` | _uuid | yes |  |
| `token_hash` | text |  |  |
| `invited_by_user_id` | uuid | yes | → `users` (on delete set null) |
| `expires_at` | timestamp with time zone |  |  |
| `accepted_at` | timestamp with time zone | yes |  |
| `revoked_at` | timestamp with time zone | yes |  |
| `created_at` | timestamp with time zone |  | `now()` |

Indexes: `INDEX invitations_org_idx (org_id)`; `UNIQUE INDEX invitations_token_uq (token_hash)`

### `organization_branding`

| Column | Type | Null | Default / reference |
|---|---|---|---|
| `org_id` | uuid |  | → `organizations` (on delete cascade) |
| `display_name` | text | yes |  |
| `logo_url` | text | yes |  |
| `primary_color` | text | yes |  |
| `secondary_color` | text | yes |  |
| `support_email` | text | yes |  |
| `support_url` | text | yes |  |
| `sender_name` | text | yes |  |
| `sender_email` | text | yes |  |
| `sender_verified_at` | timestamp with time zone | yes |  |
| `report_footer` | text | yes |  |
| `updated_at` | timestamp with time zone |  | `now()` |

### `custom_domains`

| Column | Type | Null | Default / reference |
|---|---|---|---|
| `id` | uuid |  | `gen_random_uuid()` |
| `org_id` | uuid |  | → `organizations` (on delete cascade) |
| `hostname` | text |  |  |
| `purpose` | text |  |  |
| `website_id` | uuid | yes |  |
| `verification_token` | text |  |  |
| `status` | text |  | `'pending'::text` |
| `last_checked_at` | timestamp with time zone | yes |  |
| `last_check` | jsonb | yes |  |
| `last_error` | text | yes |  |
| `verified_at` | timestamp with time zone | yes |  |
| `created_at` | timestamp with time zone |  | `now()` |

Indexes: `UNIQUE INDEX custom_domains_hostname_uq (hostname)`; `INDEX custom_domains_org_idx (org_id)`

### `rate_limits`

| Column | Type | Null | Default / reference |
|---|---|---|---|
| `key` | text |  |  |
| `count` | integer |  |  |
| `window_start` | timestamp with time zone |  |  |

## Businesses and knowledge


### `business_locations`

| Column | Type | Null | Default / reference |
|---|---|---|---|
| `id` | uuid |  | `gen_random_uuid()` |
| `org_id` | uuid |  | → `organizations` (on delete cascade) |
| `client_id` | uuid | yes | → `clients` (on delete set null) |
| `name` | text |  |  |
| `website` | text | yes |  |
| `primary_category` | text | yes |  |
| `secondary_categories` | _text |  | `'{}'::text[]` |
| `description` | text | yes |  |
| `phone` | text | yes |  |
| `email` | text | yes |  |
| `appointment_url` | text | yes |  |
| `address_line1` | text | yes |  |
| `address_line2` | text | yes |  |
| `city` | text | yes |  |
| `region` | text | yes |  |
| `postal_code` | text | yes |  |
| `country` | text | yes | `'US'::text` |
| `latitude` | double precision | yes |  |
| `longitude` | double precision | yes |  |
| `is_service_area_business` | boolean |  | `false` |
| `hide_address` | boolean |  | `false` |
| `service_area` | jsonb | yes |  |
| `hours` | jsonb | yes |  |
| `special_hours` | jsonb | yes |  |
| `timezone` | text |  | `'America/Chicago'::text` |
| `logo_asset_id` | uuid | yes |  |
| `brand` | jsonb | yes |  |
| `average_customer_value` | numeric | yes |  |
| `review_slug` | text |  |  |
| `google_review_url` | text | yes |  |
| `gbp_location_name` | text | yes |  |
| `google_place_id` | text | yes |  |
| `gbp_account_name` | text | yes |  |
| `google_integration_id` | uuid | yes |  |
| `onboarding` | jsonb |  | `'{"steps": {}}'::jsonb` |
| `onboarding_completed_at` | timestamp with time zone | yes |  |
| `status` | text |  | `'active'::text` |
| `created_at` | timestamp with time zone |  | `now()` |
| `updated_at` | timestamp with time zone |  | `now()` |

Indexes: `INDEX business_client_idx (client_id)`; `INDEX business_org_idx (org_id)`; `UNIQUE INDEX business_review_slug_uq (review_slug)`

### `business_services`

| Column | Type | Null | Default / reference |
|---|---|---|---|
| `id` | uuid |  | `gen_random_uuid()` |
| `business_id` | uuid |  | → `business_locations` (on delete cascade) |
| `name` | text |  |  |
| `category` | text | yes |  |
| `description` | text | yes |  |
| `source` | text |  |  |
| `status` | text |  | `'active'::text` |
| `sync_status` | text |  | `'local_only'::text` |
| `last_synced_at` | timestamp with time zone | yes |  |
| `last_error` | text | yes |  |
| `created_at` | timestamp with time zone |  | `now()` |
| `updated_at` | timestamp with time zone |  | `now()` |

Indexes: `INDEX services_business_idx (business_id)`

### `business_attributes`

| Column | Type | Null | Default / reference |
|---|---|---|---|
| `id` | uuid |  | `gen_random_uuid()` |
| `business_id` | uuid |  | → `business_locations` (on delete cascade) |
| `attribute_key` | text |  |  |
| `display_name` | text |  |  |
| `group_name` | text | yes |  |
| `value` | jsonb | yes |  |
| `is_factual_claim` | boolean |  | `true` |
| `status` | text |  | `'suggested'::text` |
| `source` | text |  |  |
| `confirmed_by_user_id` | uuid | yes |  |
| `confirmed_at` | timestamp with time zone | yes |  |
| `sync_status` | text |  | `'local_only'::text` |
| `last_error` | text | yes |  |
| `created_at` | timestamp with time zone |  | `now()` |

Indexes: `UNIQUE INDEX attributes_business_key_uq (business_id, attribute_key)`

### `business_knowledge`

| Column | Type | Null | Default / reference |
|---|---|---|---|
| `id` | uuid |  | `gen_random_uuid()` |
| `business_id` | uuid |  | → `business_locations` (on delete cascade) |
| `category` | text |  |  |
| `key` | text |  |  |
| `value` | text |  |  |
| `source` | text |  |  |
| `source_ref` | text | yes |  |
| `evidence` | text | yes |  |
| `verification_status` | text |  | `'unverified'::text` |
| `is_public` | boolean |  | `true` |
| `requires_confirmation` | boolean |  | `false` |
| `verified_by_user_id` | uuid | yes |  |
| `verified_at` | timestamp with time zone | yes |  |
| `created_at` | timestamp with time zone |  | `now()` |
| `updated_at` | timestamp with time zone |  | `now()` |

Indexes: `INDEX knowledge_business_idx (business_id)`; `UNIQUE INDEX knowledge_business_key_uq (business_id, category, key)`

### `training_instructions`

| Column | Type | Null | Default / reference |
|---|---|---|---|
| `id` | uuid |  | `gen_random_uuid()` |
| `business_id` | uuid |  | → `business_locations` (on delete cascade) |
| `category` | text |  |  |
| `version` | integer |  |  |
| `content` | text |  |  |
| `is_active` | boolean |  | `true` |
| `created_by_user_id` | uuid | yes |  |
| `created_at` | timestamp with time zone |  | `now()` |

Indexes: `UNIQUE INDEX training_business_cat_ver_uq (business_id, category, version)`

## Integrations


### `integrations`

| Column | Type | Null | Default / reference |
|---|---|---|---|
| `id` | uuid |  | `gen_random_uuid()` |
| `org_id` | uuid |  | → `organizations` (on delete cascade) |
| `client_id` | uuid | yes | → `clients` (on delete set null) |
| `provider` | text |  |  |
| `external_account_id` | text |  |  |
| `external_account_name` | text | yes |  |
| `scopes` | _text |  | `'{}'::text[]` |
| `access_token_enc` | text | yes |  |
| `refresh_token_enc` | text | yes |  |
| `token_expires_at` | timestamp with time zone | yes |  |
| `status` | text |  | `'active'::text` |
| `last_error` | text | yes |  |
| `last_health_check_at` | timestamp with time zone | yes |  |
| `last_success_at` | timestamp with time zone | yes |  |
| `connected_by_user_id` | uuid | yes |  |
| `connected_via` | text |  | `'user'::text` |
| `metadata` | jsonb |  | `'{}'::jsonb` |
| `created_at` | timestamp with time zone |  | `now()` |
| `updated_at` | timestamp with time zone |  | `now()` |

Indexes: `UNIQUE INDEX integrations_org_provider_account_uq (org_id, provider, external_account_id)`

### `integration_targets`

| Column | Type | Null | Default / reference |
|---|---|---|---|
| `id` | uuid |  | `gen_random_uuid()` |
| `business_id` | uuid |  | → `business_locations` (on delete cascade) |
| `integration_id` | uuid |  | → `integrations` (on delete cascade) |
| `target_type` | text |  |  |
| `external_id` | text |  |  |
| `external_name` | text | yes |  |
| `enabled` | boolean |  | `true` |
| `last_publish_at` | timestamp with time zone | yes |  |
| `created_at` | timestamp with time zone |  | `now()` |

Indexes: `UNIQUE INDEX targets_business_type_ext_uq (business_id, target_type, external_id)`

### `oauth_states`

| Column | Type | Null | Default / reference |
|---|---|---|---|
| `id` | text |  |  |
| `org_id` | uuid |  |  |
| `user_id` | uuid | yes |  |
| `provider` | text |  |  |
| `business_id` | uuid | yes |  |
| `connection_invite_id` | uuid | yes |  |
| `code_verifier` | text | yes |  |
| `redirect_to` | text | yes |  |
| `expires_at` | timestamp with time zone |  |  |
| `created_at` | timestamp with time zone |  | `now()` |

### `connection_invites`

| Column | Type | Null | Default / reference |
|---|---|---|---|
| `id` | uuid |  | `gen_random_uuid()` |
| `org_id` | uuid |  | → `organizations` (on delete cascade) |
| `client_id` | uuid | yes | → `clients` (on delete cascade) |
| `business_id` | uuid | yes | → `business_locations` (on delete cascade) |
| `provider` | text |  |  |
| `token_hash` | text |  |  |
| `recipient_email` | text | yes |  |
| `expires_at` | timestamp with time zone |  |  |
| `used_at` | timestamp with time zone | yes |  |
| `revoked_at` | timestamp with time zone | yes |  |
| `outcome` | text | yes |  |
| `created_by_user_id` | uuid | yes |  |
| `created_at` | timestamp with time zone |  | `now()` |

Indexes: `UNIQUE INDEX connection_invites_token_uq (token_hash)`

## Keywords, rankings and competitors


### `keywords`

| Column | Type | Null | Default / reference |
|---|---|---|---|
| `id` | uuid |  | `gen_random_uuid()` |
| `business_id` | uuid |  | → `business_locations` (on delete cascade) |
| `phrase` | text |  |  |
| `normalized` | text |  |  |
| `intent` | text |  | `'discovery'::text` |
| `service_id` | uuid | yes | → `business_services` (on delete set null) |
| `city` | text | yes |  |
| `priority` | integer |  | `3` |
| `is_tracked` | boolean |  | `true` |
| `source` | text |  | `'user'::text` |
| `demand_estimate` | integer | yes |  |
| `demand_source` | text | yes |  |
| `demand_as_of` | timestamp with time zone | yes |  |
| `archived_at` | timestamp with time zone | yes |  |
| `created_at` | timestamp with time zone |  | `now()` |
| `updated_at` | timestamp with time zone |  | `now()` |

Indexes: `UNIQUE INDEX keywords_business_norm_city_uq (business_id, normalized, COALESCE(city, ''::text))`

### `keyword_demand_history`

| Column | Type | Null | Default / reference |
|---|---|---|---|
| `id` | uuid |  | `gen_random_uuid()` |
| `keyword_id` | uuid |  | → `keywords` (on delete cascade) |
| `estimate` | integer | yes |  |
| `source` | text |  |  |
| `is_demo` | boolean |  | `false` |
| `observed_at` | timestamp with time zone |  | `now()` |

### `audit_configurations`

| Column | Type | Null | Default / reference |
|---|---|---|---|
| `id` | uuid |  | `gen_random_uuid()` |
| `business_id` | uuid |  | → `business_locations` (on delete cascade) |
| `keyword_id` | uuid |  | → `keywords` (on delete cascade) |
| `version` | integer |  |  |
| `center_lat` | double precision |  |  |
| `center_lng` | double precision |  |  |
| `radius_km` | double precision |  |  |
| `grid_size` | integer |  |  |
| `device` | text |  | `'mobile'::text` |
| `language` | text |  | `'en'::text` |
| `provider` | text |  |  |
| `is_current` | boolean |  | `true` |
| `change_note` | text | yes |  |
| `created_by_user_id` | uuid | yes |  |
| `created_at` | timestamp with time zone |  | `now()` |

Indexes: `UNIQUE INDEX audit_config_keyword_version_uq (keyword_id, version)`

### `ranking_audits`

| Column | Type | Null | Default / reference |
|---|---|---|---|
| `id` | uuid |  | `gen_random_uuid()` |
| `business_id` | uuid |  | → `business_locations` (on delete cascade) |
| `configuration_id` | uuid |  | → `audit_configurations` (on delete restrict) |
| `status` | text |  | `'queued'::text` |
| `provider` | text |  |  |
| `is_demo` | boolean |  | `false` |
| `trigger` | text |  | `'manual'::text` |
| `points_total` | integer |  | `0` |
| `points_succeeded` | integer |  | `0` |
| `stats` | jsonb | yes |  |
| `error` | text | yes |  |
| `started_at` | timestamp with time zone | yes |  |
| `completed_at` | timestamp with time zone | yes |  |
| `created_at` | timestamp with time zone |  | `now()` |

Indexes: `INDEX ranking_audits_business_idx (business_id, created_at)`

### `ranking_observations`

| Column | Type | Null | Default / reference |
|---|---|---|---|
| `id` | uuid |  | `gen_random_uuid()` |
| `audit_id` | uuid |  | → `ranking_audits` (on delete cascade) |
| `point_index` | integer |  |  |
| `lat` | double precision |  |  |
| `lng` | double precision |  |  |
| `status` | text |  |  |
| `rank` | integer | yes |  |
| `matched_place_id` | text | yes |  |
| `results` | jsonb | yes |  |
| `error` | text | yes |  |
| `provider_ref` | text | yes |  |
| `observed_at` | timestamp with time zone |  | `now()` |

Indexes: `UNIQUE INDEX ranking_obs_audit_point_uq (audit_id, point_index)`

### `competitors`

| Column | Type | Null | Default / reference |
|---|---|---|---|
| `id` | uuid |  | `gen_random_uuid()` |
| `business_id` | uuid |  | → `business_locations` (on delete cascade) |
| `place_id` | text |  |  |
| `name` | text |  |  |
| `address` | text | yes |  |
| `is_tracked` | boolean |  | `false` |
| `first_seen_at` | timestamp with time zone |  | `now()` |
| `last_seen_at` | timestamp with time zone |  | `now()` |
| `is_demo` | boolean |  | `false` |
| `created_at` | timestamp with time zone |  | `now()` |

Indexes: `UNIQUE INDEX competitors_business_place_uq (business_id, place_id)`

### `competitor_snapshots`

| Column | Type | Null | Default / reference |
|---|---|---|---|
| `id` | uuid |  | `gen_random_uuid()` |
| `competitor_id` | uuid |  | → `competitors` (on delete cascade) |
| `audit_id` | uuid | yes | → `ranking_audits` (on delete cascade) |
| `keyword_id` | uuid | yes | → `keywords` (on delete cascade) |
| `appearances` | integer |  | `0` |
| `average_rank` | double precision | yes |  |
| `top3_count` | integer |  | `0` |
| `rating` | double precision | yes |  |
| `review_count` | integer | yes |  |
| `captured_at` | timestamp with time zone |  | `now()` |

## Profile optimization


### `profile_recommendations`

| Column | Type | Null | Default / reference |
|---|---|---|---|
| `id` | uuid |  | `gen_random_uuid()` |
| `business_id` | uuid |  | → `business_locations` (on delete cascade) |
| `field` | text |  |  |
| `issue` | text |  |  |
| `current_value` | jsonb | yes |  |
| `proposed_value` | jsonb | yes |  |
| `reason` | text |  |  |
| `impact` | text |  |  |
| `confidence` | double precision |  |  |
| `auto_applicable` | boolean |  | `false` |
| `requires_fact_confirmation` | boolean |  | `false` |
| `status` | text |  | `'open'::text` |
| `next_action` | text | yes |  |
| `task_id` | uuid | yes |  |
| `apply_result` | jsonb | yes |  |
| `applied_at` | timestamp with time zone | yes |  |
| `generation` | jsonb | yes |  |
| `created_at` | timestamp with time zone |  | `now()` |
| `updated_at` | timestamp with time zone |  | `now()` |

Indexes: `INDEX profile_recs_business_idx (business_id, status)`

### `profile_changes`

| Column | Type | Null | Default / reference |
|---|---|---|---|
| `id` | uuid |  | `gen_random_uuid()` |
| `business_id` | uuid |  | → `business_locations` (on delete cascade) |
| `field` | text |  |  |
| `before` | jsonb | yes |  |
| `after` | jsonb | yes |  |
| `origin` | text |  |  |
| `actor_user_id` | uuid | yes |  |
| `sync_status` | text |  | `'local_only'::text` |
| `synced_at` | timestamp with time zone | yes |  |
| `sync_error` | text | yes |  |
| `created_at` | timestamp with time zone |  | `now()` |

Indexes: `INDEX profile_changes_business_idx (business_id, created_at)`

### `optimization_scores`

| Column | Type | Null | Default / reference |
|---|---|---|---|
| `id` | uuid |  | `gen_random_uuid()` |
| `business_id` | uuid |  | → `business_locations` (on delete cascade) |
| `score` | integer |  |  |
| `breakdown` | jsonb |  |  |
| `computed_at` | timestamp with time zone |  | `now()` |

## Reviews and review requests


### `reviews`

| Column | Type | Null | Default / reference |
|---|---|---|---|
| `id` | uuid |  | `gen_random_uuid()` |
| `business_id` | uuid |  | → `business_locations` (on delete cascade) |
| `source` | text |  |  |
| `external_id` | text |  |  |
| `reviewer_name` | text | yes |  |
| `rating` | integer |  |  |
| `text` | text | yes |  |
| `published_at` | timestamp with time zone |  |  |
| `owner_reply` | text | yes |  |
| `owner_reply_at` | timestamp with time zone | yes |  |
| `reply_status` | text |  | `'unanswered'::text` |
| `policy_applied` | text | yes |  |
| `sentiment` | text | yes |  |
| `analysis` | jsonb | yes |  |
| `is_demo` | boolean |  | `false` |
| `fetched_at` | timestamp with time zone |  | `now()` |
| `created_at` | timestamp with time zone |  | `now()` |

Indexes: `INDEX reviews_business_published_idx (business_id, published_at)`; `UNIQUE INDEX reviews_business_source_ext_uq (business_id, source, external_id)`

### `review_replies`

| Column | Type | Null | Default / reference |
|---|---|---|---|
| `id` | uuid |  | `gen_random_uuid()` |
| `review_id` | uuid |  | → `reviews` (on delete cascade) |
| `business_id` | uuid |  | → `business_locations` (on delete cascade) |
| `content` | text |  |  |
| `origin` | text |  |  |
| `status` | text |  | `'draft'::text` |
| `validation` | jsonb | yes |  |
| `generation` | jsonb | yes |  |
| `task_id` | uuid | yes |  |
| `publication_job_id` | uuid | yes |  |
| `published_at` | timestamp with time zone | yes |  |
| `created_by_user_id` | uuid | yes |  |
| `created_at` | timestamp with time zone |  | `now()` |
| `updated_at` | timestamp with time zone |  | `now()` |

Indexes: `INDEX review_replies_review_idx (review_id)`

### `review_policies`

| Column | Type | Null | Default / reference |
|---|---|---|---|
| `business_id` | uuid |  | → `business_locations` (on delete cascade) |
| `rating` | integer |  |  |
| `mode` | text |  |  |
| `template_id` | uuid | yes |  |
| `template_requires_approval` | boolean |  | `false` |
| `escalate` | boolean |  | `false` |
| `updated_at` | timestamp with time zone |  | `now()` |

Indexes: `UNIQUE INDEX review_policies_business_id_rating_pk (business_id, rating)`

### `review_templates`

| Column | Type | Null | Default / reference |
|---|---|---|---|
| `id` | uuid |  | `gen_random_uuid()` |
| `business_id` | uuid |  | → `business_locations` (on delete cascade) |
| `name` | text |  |  |
| `body` | text |  |  |
| `created_at` | timestamp with time zone |  | `now()` |

### `review_reports`

| Column | Type | Null | Default / reference |
|---|---|---|---|
| `id` | uuid |  | `gen_random_uuid()` |
| `review_id` | uuid |  | → `reviews` (on delete cascade) |
| `business_id` | uuid |  | → `business_locations` (on delete cascade) |
| `reason` | text |  |  |
| `evidence` | text | yes |  |
| `detected_signals` | jsonb | yes |  |
| `status` | text |  | `'draft'::text` |
| `submission_method` | text | yes |  |
| `submitted_at` | timestamp with time zone | yes |  |
| `submitted_by_user_id` | uuid | yes |  |
| `outcome_at` | timestamp with time zone | yes |  |
| `notes` | text | yes |  |
| `created_at` | timestamp with time zone |  | `now()` |

### `review_links`

| Column | Type | Null | Default / reference |
|---|---|---|---|
| `id` | uuid |  | `gen_random_uuid()` |
| `business_id` | uuid |  | → `business_locations` (on delete cascade) |
| `slug` | text |  |  |
| `label` | text |  |  |
| `salesperson` | text | yes |  |
| `service` | text | yes |  |
| `campaign_id` | uuid | yes |  |
| `photo_boost_enabled` | boolean |  | `true` |
| `archived_at` | timestamp with time zone | yes |  |
| `created_at` | timestamp with time zone |  | `now()` |

Indexes: `UNIQUE INDEX review_links_business_slug_uq (business_id, slug)`

### `review_link_events`

| Column | Type | Null | Default / reference |
|---|---|---|---|
| `id` | uuid |  | `gen_random_uuid()` |
| `link_id` | uuid | yes | → `review_links` (on delete cascade) |
| `business_id` | uuid |  | → `business_locations` (on delete cascade) |
| `contact_id` | uuid | yes |  |
| `type` | text |  |  |
| `meta` | jsonb | yes |  |
| `created_at` | timestamp with time zone |  | `now()` |

Indexes: `INDEX review_link_events_business_idx (business_id, created_at)`

### `review_campaigns`

| Column | Type | Null | Default / reference |
|---|---|---|---|
| `id` | uuid |  | `gen_random_uuid()` |
| `business_id` | uuid |  | → `business_locations` (on delete cascade) |
| `name` | text |  |  |
| `status` | text |  | `'draft'::text` |
| `channel` | text |  | `'email'::text` |
| `subject` | text |  |  |
| `message_template` | text |  |  |
| `follow_up` | jsonb |  |  |
| `daily_limit` | integer |  | `50` |
| `send_window` | jsonb |  |  |
| `start_at` | timestamp with time zone | yes |  |
| `link_id` | uuid | yes |  |
| `created_by_user_id` | uuid | yes |  |
| `paused_at` | timestamp with time zone | yes |  |
| `completed_at` | timestamp with time zone | yes |  |
| `created_at` | timestamp with time zone |  | `now()` |
| `updated_at` | timestamp with time zone |  | `now()` |

### `campaign_contacts`

| Column | Type | Null | Default / reference |
|---|---|---|---|
| `id` | uuid |  | `gen_random_uuid()` |
| `campaign_id` | uuid |  | → `review_campaigns` (on delete cascade) |
| `business_id` | uuid |  | → `business_locations` (on delete cascade) |
| `name` | text | yes |  |
| `email` | text | yes |  |
| `email_normalized` | text | yes |  |
| `phone` | text | yes |  |
| `service_label` | text | yes |  |
| `salesperson` | text | yes |  |
| `status` | text |  | `'pending'::text` |
| `validation_errors` | _text | yes |  |
| `sends` | integer |  | `0` |
| `enrolled_at` | timestamp with time zone | yes |  |
| `last_sent_at` | timestamp with time zone | yes |  |
| `next_send_at` | timestamp with time zone | yes |  |
| `clicked_at` | timestamp with time zone | yes |  |
| `opt_out_token` | text |  |  |
| `last_error` | text | yes |  |
| `created_at` | timestamp with time zone |  | `now()` |

Indexes: `INDEX campaign_contacts_due_idx (campaign_id, status, next_send_at)`; `UNIQUE INDEX campaign_contacts_email_uq (campaign_id, email_normalized)`; `UNIQUE INDEX campaign_contacts_optout_uq (opt_out_token)`

### `suppressions`

| Column | Type | Null | Default / reference |
|---|---|---|---|
| `id` | uuid |  | `gen_random_uuid()` |
| `org_id` | uuid |  | → `organizations` (on delete cascade) |
| `business_id` | uuid | yes | → `business_locations` (on delete cascade) |
| `email_normalized` | text |  |  |
| `reason` | text |  |  |
| `created_at` | timestamp with time zone |  | `now()` |

Indexes: `UNIQUE INDEX suppressions_org_email_uq (org_id, email_normalized)`

## Media


### `media_assets`

| Column | Type | Null | Default / reference |
|---|---|---|---|
| `id` | uuid |  | `gen_random_uuid()` |
| `business_id` | uuid |  | → `business_locations` (on delete cascade) |
| `kind` | text |  |  |
| `source` | text |  |  |
| `storage_key` | text |  |  |
| `mime` | text |  |  |
| `bytes` | integer |  |  |
| `width` | integer | yes |  |
| `height` | integer | yes |  |
| `duration_ms` | integer | yes |  |
| `sha256` | text |  |  |
| `perceptual_hash` | text | yes |  |
| `original_filename` | text | yes |  |
| `seo_filename` | text | yes |  |
| `alt_text` | text | yes |  |
| `description` | text | yes |  |
| `description_source` | text |  | `'none'::text` |
| `exif_lat` | double precision | yes |  |
| `exif_lng` | double precision | yes |  |
| `exif_taken_at` | timestamp with time zone | yes |  |
| `exif` | jsonb | yes |  |
| `assoc_label` | text | yes |  |
| `assoc_lat` | double precision | yes |  |
| `assoc_lng` | double precision | yes |  |
| `uploaded_by_user_id` | uuid | yes |  |
| `contributor_name` | text | yes |  |
| `contributor_email` | text | yes |  |
| `consent` | jsonb | yes |  |
| `attribution` | text | yes |  |
| `external_ref` | text | yes |  |
| `moderation_status` | text |  | `'approved'::text` |
| `moderation_notes` | text | yes |  |
| `use_for_posts` | boolean |  | `true` |
| `use_for_website` | boolean |  | `true` |
| `use_for_videos` | boolean |  | `true` |
| `use_for_google_media` | boolean |  | `true` |
| `tags` | _text |  | `'{}'::text[]` |
| `is_ai_generated` | boolean |  | `false` |
| `parent_asset_id` | uuid | yes |  |
| `deleted_at` | timestamp with time zone | yes |  |
| `created_at` | timestamp with time zone |  | `now()` |

Indexes: `INDEX media_business_idx (business_id, created_at)`; `UNIQUE INDEX media_business_sha_uq (business_id, sha256)`

### `media_variants`

| Column | Type | Null | Default / reference |
|---|---|---|---|
| `id` | uuid |  | `gen_random_uuid()` |
| `asset_id` | uuid |  | → `media_assets` (on delete cascade) |
| `variant` | text |  |  |
| `storage_key` | text |  |  |
| `mime` | text |  |  |
| `width` | integer |  |  |
| `height` | integer |  |  |
| `bytes` | integer |  |  |

Indexes: `UNIQUE INDEX media_variant_uq (asset_id, variant)`

### `media_usages`

| Column | Type | Null | Default / reference |
|---|---|---|---|
| `id` | uuid |  | `gen_random_uuid()` |
| `asset_id` | uuid |  | → `media_assets` (on delete cascade) |
| `business_id` | uuid |  | → `business_locations` (on delete cascade) |
| `usage_type` | text |  |  |
| `ref_id` | uuid | yes |  |
| `used_at` | timestamp with time zone |  | `now()` |

Indexes: `INDEX media_usages_asset_idx (asset_id, used_at)`

### `upload_links`

| Column | Type | Null | Default / reference |
|---|---|---|---|
| `id` | uuid |  | `gen_random_uuid()` |
| `business_id` | uuid |  | → `business_locations` (on delete cascade) |
| `token_hash` | text |  |  |
| `label` | text |  |  |
| `require_approval` | boolean |  | `true` |
| `expires_at` | timestamp with time zone |  |  |
| `revoked_at` | timestamp with time zone | yes |  |
| `uploads_count` | integer |  | `0` |
| `created_by_user_id` | uuid | yes |  |
| `created_at` | timestamp with time zone |  | `now()` |

Indexes: `UNIQUE INDEX upload_links_token_uq (token_hash)`

## Content, publishing, tasks and automation


### `content_items`

| Column | Type | Null | Default / reference |
|---|---|---|---|
| `id` | uuid |  | `gen_random_uuid()` |
| `business_id` | uuid |  | → `business_locations` (on delete cascade) |
| `type` | text |  |  |
| `title` | text | yes |  |
| `body` | text |  |  |
| `cta_type` | text | yes |  |
| `cta_url` | text | yes |  |
| `media_asset_id` | uuid | yes |  |
| `image_mode` | text |  | `'none'::text` |
| `branding` | jsonb | yes |  |
| `image_source` | text |  | `'none'::text` |
| `destinations` | _text |  | `'{google}'::text[]` |
| `status` | text |  | `'draft'::text` |
| `scheduled_for` | timestamp with time zone | yes |  |
| `approval_required` | boolean |  | `false` |
| `approval_reason` | text | yes |  |
| `holiday` | text | yes |  |
| `content_hash` | text |  |  |
| `validation` | jsonb | yes |  |
| `generation` | jsonb | yes |  |
| `automation_execution_id` | uuid | yes |  |
| `task_id` | uuid | yes |  |
| `created_by_user_id` | uuid | yes |  |
| `published_at` | timestamp with time zone | yes |  |
| `created_at` | timestamp with time zone |  | `now()` |
| `updated_at` | timestamp with time zone |  | `now()` |

Indexes: `INDEX content_business_status_idx (business_id, type, status)`; `INDEX content_scheduled_idx (status, scheduled_for)`

### `publication_jobs`

| Column | Type | Null | Default / reference |
|---|---|---|---|
| `id` | uuid |  | `gen_random_uuid()` |
| `business_id` | uuid |  | → `business_locations` (on delete cascade) |
| `kind` | text |  |  |
| `ref_type` | text |  |  |
| `ref_id` | uuid |  |  |
| `destination` | text |  |  |
| `target_id` | uuid | yes |  |
| `requested_for` | timestamp with time zone |  |  |
| `last_attempt_at` | timestamp with time zone | yes |  |
| `completed_at` | timestamp with time zone | yes |  |
| `attempts` | integer |  | `0` |
| `status` | text |  | `'queued'::text` |
| `idempotency_key` | text |  |  |
| `provider_id` | text | yes |  |
| `provider_url` | text | yes |  |
| `provider_response` | jsonb | yes |  |
| `last_error` | text | yes |  |
| `is_demo` | boolean |  | `false` |
| `created_at` | timestamp with time zone |  | `now()` |

Indexes: `UNIQUE INDEX publication_jobs_idem_uq (idempotency_key)`; `INDEX publication_jobs_ref_idx (ref_type, ref_id)`

### `tasks`

| Column | Type | Null | Default / reference |
|---|---|---|---|
| `id` | uuid |  | `gen_random_uuid()` |
| `org_id` | uuid |  | → `organizations` (on delete cascade) |
| `business_id` | uuid |  | → `business_locations` (on delete cascade) |
| `type` | text |  |  |
| `title` | text |  |  |
| `summary` | text | yes |  |
| `ref_type` | text |  |  |
| `ref_id` | uuid |  |  |
| `status` | text |  | `'open'::text` |
| `kind` | text |  | `'approval'::text` |
| `assignee_user_id` | uuid | yes |  |
| `assignee_email` | text | yes |  |
| `notification_recipients` | _text |  | `'{}'::text[]` |
| `visible_in_dashboard` | boolean |  | `true` |
| `client_can_approve` | boolean |  | `true` |
| `due_at` | timestamp with time zone | yes |  |
| `created_by` | text |  | `'system'::text` |
| `resolved_at` | timestamp with time zone | yes |  |
| `resolved_by` | text | yes |  |
| `resolution_note` | text | yes |  |
| `outcome` | jsonb | yes |  |
| `created_at` | timestamp with time zone |  | `now()` |
| `updated_at` | timestamp with time zone |  | `now()` |

Indexes: `INDEX tasks_business_idx (business_id, status)`; `UNIQUE INDEX tasks_open_ref_uq (ref_type, ref_id) WHERE (status = 'open'::text)`; `INDEX tasks_org_status_idx (org_id, status)`

### `task_events`

| Column | Type | Null | Default / reference |
|---|---|---|---|
| `id` | uuid |  | `gen_random_uuid()` |
| `task_id` | uuid |  | → `tasks` (on delete cascade) |
| `action` | text |  |  |
| `actor_type` | text |  |  |
| `actor_id` | text | yes |  |
| `detail` | jsonb | yes |  |
| `created_at` | timestamp with time zone |  | `now()` |

Indexes: `INDEX task_events_task_idx (task_id)`

### `approval_tokens`

| Column | Type | Null | Default / reference |
|---|---|---|---|
| `id` | uuid |  | `gen_random_uuid()` |
| `task_id` | uuid |  | → `tasks` (on delete cascade) |
| `token_hash` | text |  |  |
| `recipient_email` | text |  |  |
| `allowed_actions` | _text |  |  |
| `expires_at` | timestamp with time zone |  |  |
| `used_at` | timestamp with time zone | yes |  |
| `revoked_at` | timestamp with time zone | yes |  |
| `created_at` | timestamp with time zone |  | `now()` |

Indexes: `UNIQUE INDEX approval_tokens_hash_uq (token_hash)`; `INDEX approval_tokens_task_idx (task_id)`

### `automation_rules`

| Column | Type | Null | Default / reference |
|---|---|---|---|
| `id` | uuid |  | `gen_random_uuid()` |
| `business_id` | uuid |  | → `business_locations` (on delete cascade) |
| `type` | text |  |  |
| `enabled` | boolean |  | `false` |
| `schedule` | jsonb |  |  |
| `config` | jsonb |  | `'{}'::jsonb` |
| `approval_mode` | text |  | `'all'::text` |
| `notification_recipients` | _text |  | `'{}'::text[]` |
| `show_tasks_in_dashboard` | boolean |  | `true` |
| `max_retries` | integer |  | `3` |
| `last_run_at` | timestamp with time zone | yes |  |
| `next_run_at` | timestamp with time zone | yes |  |
| `last_success_at` | timestamp with time zone | yes |  |
| `last_failure_at` | timestamp with time zone | yes |  |
| `last_error` | text | yes |  |
| `consecutive_failures` | integer |  | `0` |
| `updated_by_user_id` | uuid | yes |  |
| `created_at` | timestamp with time zone |  | `now()` |
| `updated_at` | timestamp with time zone |  | `now()` |

Indexes: `UNIQUE INDEX automation_rules_business_type_uq (business_id, type)`; `INDEX automation_rules_due_idx (enabled, next_run_at)`

### `automation_executions`

| Column | Type | Null | Default / reference |
|---|---|---|---|
| `id` | uuid |  | `gen_random_uuid()` |
| `rule_id` | uuid |  | → `automation_rules` (on delete cascade) |
| `business_id` | uuid |  | → `business_locations` (on delete cascade) |
| `trigger` | text |  |  |
| `status` | text |  | `'queued'::text` |
| `scheduled_for` | timestamp with time zone |  |  |
| `started_at` | timestamp with time zone | yes |  |
| `finished_at` | timestamp with time zone | yes |  |
| `summary` | jsonb | yes |  |
| `error` | text | yes |  |
| `idempotency_key` | text |  |  |
| `created_at` | timestamp with time zone |  | `now()` |

Indexes: `UNIQUE INDEX automation_exec_idem_uq (idempotency_key)`; `INDEX automation_exec_rule_idx (rule_id, created_at)`

### `jobs`

| Column | Type | Null | Default / reference |
|---|---|---|---|
| `id` | bigint |  | `nextval('jobs_id_seq'::regclass)` |
| `queue` | text |  | `'default'::text` |
| `name` | text |  |  |
| `payload` | jsonb |  |  |
| `status` | text |  | `'pending'::text` |
| `run_at` | timestamp with time zone |  | `now()` |
| `attempts` | integer |  | `0` |
| `max_attempts` | integer |  | `5` |
| `backoff_base_ms` | integer |  | `30000` |
| `timeout_ms` | integer |  | `300000` |
| `locked_by` | text | yes |  |
| `locked_at` | timestamp with time zone | yes |  |
| `last_error` | text | yes |  |
| `result` | jsonb | yes |  |
| `idempotency_key` | text | yes |  |
| `org_id` | uuid | yes |  |
| `business_id` | uuid | yes |  |
| `created_at` | timestamp with time zone |  | `now()` |
| `completed_at` | timestamp with time zone | yes |  |

Indexes: `INDEX jobs_business_idx (business_id, created_at)`; `UNIQUE INDEX jobs_idem_uq (idempotency_key)`; `INDEX jobs_pending_idx (queue, status, run_at)`

## Video


### `video_projects`

| Column | Type | Null | Default / reference |
|---|---|---|---|
| `id` | uuid |  | `gen_random_uuid()` |
| `business_id` | uuid |  | → `business_locations` (on delete cascade) |
| `title` | text |  |  |
| `format` | text |  | `'vertical'::text` |
| `status` | text |  | `'draft'::text` |
| `settings` | jsonb |  |  |
| `brief` | text | yes |  |
| `destinations` | _text |  | `'{}'::text[]` |
| `output_asset_id` | uuid | yes |  |
| `preview_asset_id` | uuid | yes |  |
| `rendered_revision` | integer | yes |  |
| `revision` | integer |  | `1` |
| `render_error` | text | yes |  |
| `render_log` | jsonb | yes |  |
| `task_id` | uuid | yes |  |
| `created_by_user_id` | uuid | yes |  |
| `created_at` | timestamp with time zone |  | `now()` |
| `updated_at` | timestamp with time zone |  | `now()` |

### `video_scenes`

| Column | Type | Null | Default / reference |
|---|---|---|---|
| `id` | uuid |  | `gen_random_uuid()` |
| `project_id` | uuid |  | → `video_projects` (on delete cascade) |
| `position` | integer |  |  |
| `media_asset_id` | uuid | yes |  |
| `is_b_roll` | boolean |  | `false` |
| `narration` | text |  | `''::text` |
| `voice_id` | text | yes |  |
| `delivery_instruction` | text | yes |  |
| `pronunciation_overrides` | jsonb | yes |  |
| `overlay_text` | text | yes |  |
| `duration_ms` | integer |  | `4000` |
| `transition` | text |  | `'fade'::text` |
| `effect` | text |  | `'zoom_in'::text` |
| `audio_asset_id` | uuid | yes |  |
| `audio_hash` | text | yes |  |
| `segment_asset_id` | uuid | yes |  |
| `segment_hash` | text | yes |  |
| `updated_at` | timestamp with time zone |  | `now()` |

Indexes: `INDEX video_scenes_project_idx (project_id, "position")`

## Websites and AI SEO


### `websites`

| Column | Type | Null | Default / reference |
|---|---|---|---|
| `id` | uuid |  | `gen_random_uuid()` |
| `business_id` | uuid |  | → `business_locations` (on delete cascade) |
| `slug` | text |  |  |
| `name` | text |  |  |
| `theme` | jsonb |  |  |
| `status` | text |  | `'draft'::text` |
| `published_revision_id` | uuid | yes |  |
| `published_at` | timestamp with time zone | yes |  |
| `custom_domain_id` | uuid | yes |  |
| `settings` | jsonb |  |  |
| `generation_error` | text | yes |  |
| `created_at` | timestamp with time zone |  | `now()` |
| `updated_at` | timestamp with time zone |  | `now()` |

Indexes: `INDEX websites_business_idx (business_id)`; `UNIQUE INDEX websites_slug_uq (slug)`

### `website_pages`

| Column | Type | Null | Default / reference |
|---|---|---|---|
| `id` | uuid |  | `gen_random_uuid()` |
| `website_id` | uuid |  | → `websites` (on delete cascade) |
| `path` | text |  |  |
| `type` | text |  |  |
| `title` | text |  |  |
| `nav_label` | text |  |  |
| `meta_title` | text | yes |  |
| `meta_description` | text | yes |  |
| `canonical_url` | text | yes |  |
| `noindex` | boolean |  | `false` |
| `sections` | jsonb |  |  |
| `position` | integer |  | `0` |
| `updated_at` | timestamp with time zone |  | `now()` |
| `created_at` | timestamp with time zone |  | `now()` |

Indexes: `UNIQUE INDEX website_pages_path_uq (website_id, path)`

### `website_revisions`

| Column | Type | Null | Default / reference |
|---|---|---|---|
| `id` | uuid |  | `gen_random_uuid()` |
| `website_id` | uuid |  | → `websites` (on delete cascade) |
| `number` | integer |  |  |
| `snapshot` | jsonb |  |  |
| `note` | text | yes |  |
| `created_by_user_id` | uuid | yes |  |
| `created_at` | timestamp with time zone |  | `now()` |

Indexes: `UNIQUE INDEX website_revisions_number_uq (website_id, number)`

### `website_deployments`

| Column | Type | Null | Default / reference |
|---|---|---|---|
| `id` | uuid |  | `gen_random_uuid()` |
| `website_id` | uuid |  | → `websites` (on delete cascade) |
| `revision_id` | uuid |  | → `website_revisions` (on delete cascade) |
| `status` | text |  |  |
| `checks` | jsonb | yes |  |
| `url` | text | yes |  |
| `error` | text | yes |  |
| `created_by_user_id` | uuid | yes |  |
| `created_at` | timestamp with time zone |  | `now()` |

### `faqs`

| Column | Type | Null | Default / reference |
|---|---|---|---|
| `id` | uuid |  | `gen_random_uuid()` |
| `business_id` | uuid |  | → `business_locations` (on delete cascade) |
| `question` | text |  |  |
| `answer` | text |  |  |
| `status` | text |  | `'draft'::text` |
| `source_fact_ids` | _uuid | yes |  |
| `validation` | jsonb | yes |  |
| `question_hash` | text |  |  |
| `task_id` | uuid | yes |  |
| `published_at` | timestamp with time zone | yes |  |
| `stale_since` | timestamp with time zone | yes |  |
| `created_at` | timestamp with time zone |  | `now()` |
| `updated_at` | timestamp with time zone |  | `now()` |

Indexes: `UNIQUE INDEX faqs_business_qhash_uq (business_id, question_hash)`

### `seo_audits`

| Column | Type | Null | Default / reference |
|---|---|---|---|
| `id` | uuid |  | `gen_random_uuid()` |
| `business_id` | uuid |  | → `business_locations` (on delete cascade) |
| `url` | text |  |  |
| `status` | text |  | `'queued'::text` |
| `extracted` | jsonb | yes |  |
| `http_status` | integer | yes |  |
| `error` | text | yes |  |
| `started_at` | timestamp with time zone | yes |  |
| `completed_at` | timestamp with time zone | yes |  |
| `created_at` | timestamp with time zone |  | `now()` |

### `seo_recommendations`

| Column | Type | Null | Default / reference |
|---|---|---|---|
| `id` | uuid |  | `gen_random_uuid()` |
| `audit_id` | uuid |  | → `seo_audits` (on delete cascade) |
| `business_id` | uuid |  | → `business_locations` (on delete cascade) |
| `element` | text |  |  |
| `current_value` | text | yes |  |
| `recommended_value` | text | yes |  |
| `status` | text |  |  |
| `basis` | text |  |  |
| `explanation` | text |  |  |
| `confidence` | double precision |  |  |
| `instructions` | text | yes |  |
| `applied_at` | timestamp with time zone | yes |  |
| `rechecked_at` | timestamp with time zone | yes |  |
| `created_at` | timestamp with time zone |  | `now()` |

Indexes: `INDEX seo_recs_business_idx (business_id)`

### `schema_documents`

| Column | Type | Null | Default / reference |
|---|---|---|---|
| `id` | uuid |  | `gen_random_uuid()` |
| `business_id` | uuid |  | → `business_locations` (on delete cascade) |
| `json_ld` | jsonb |  |  |
| `validation` | jsonb |  |  |
| `is_current` | boolean |  | `true` |
| `created_at` | timestamp with time zone |  | `now()` |

### `ai_visibility_audits`

| Column | Type | Null | Default / reference |
|---|---|---|---|
| `id` | uuid |  | `gen_random_uuid()` |
| `business_id` | uuid |  | → `business_locations` (on delete cascade) |
| `status` | text |  | `'queued'::text` |
| `providers` | _text |  |  |
| `template_version` | text |  |  |
| `trigger` | text |  | `'manual'::text` |
| `stats` | jsonb | yes |  |
| `created_at` | timestamp with time zone |  | `now()` |
| `completed_at` | timestamp with time zone | yes |  |

### `ai_visibility_queries`

| Column | Type | Null | Default / reference |
|---|---|---|---|
| `id` | uuid |  | `gen_random_uuid()` |
| `audit_id` | uuid |  | → `ai_visibility_audits` (on delete cascade) |
| `business_id` | uuid |  | → `business_locations` (on delete cascade) |
| `keyword_id` | uuid | yes | → `keywords` (on delete set null) |
| `keyword` | text |  |  |
| `city` | text | yes |  |
| `query_text` | text |  |  |
| `provider` | text |  |  |
| `model` | text | yes |  |
| `status` | text |  | `'queued'::text` |
| `response_text` | text | yes |  |
| `sources` | jsonb | yes |  |
| `mentioned_businesses` | jsonb | yes |  |
| `mentioned` | boolean | yes |  |
| `position` | integer | yes |  |
| `error` | text | yes |  |
| `is_demo` | boolean |  | `false` |
| `ran_at` | timestamp with time zone | yes |  |

Indexes: `INDEX ai_vis_queries_audit_idx (audit_id)`

## Reporting, usage and notifications


### `performance_metrics`

| Column | Type | Null | Default / reference |
|---|---|---|---|
| `id` | uuid |  | `gen_random_uuid()` |
| `business_id` | uuid |  | → `business_locations` (on delete cascade) |
| `metric` | text |  |  |
| `date` | date |  |  |
| `value` | integer |  |  |
| `source` | text |  |  |
| `is_demo` | boolean |  | `false` |
| `fetched_at` | timestamp with time zone |  | `now()` |

Indexes: `UNIQUE INDEX perf_metrics_uq (business_id, metric, date, source)`

### `reports`

| Column | Type | Null | Default / reference |
|---|---|---|---|
| `id` | uuid |  | `gen_random_uuid()` |
| `org_id` | uuid |  | → `organizations` (on delete cascade) |
| `business_id` | uuid |  | → `business_locations` (on delete cascade) |
| `type` | text |  |  |
| `period_start` | date |  |  |
| `period_end` | date |  |  |
| `status` | text |  | `'queued'::text` |
| `data` | jsonb | yes |  |
| `narrative` | text | yes |  |
| `html` | text | yes |  |
| `error` | text | yes |  |
| `credits_charged` | integer |  | `0` |
| `requested_by_user_id` | uuid | yes |  |
| `generated_at` | timestamp with time zone | yes |  |
| `created_at` | timestamp with time zone |  | `now()` |

Indexes: `INDEX reports_business_idx (business_id, created_at)`

### `report_deliveries`

| Column | Type | Null | Default / reference |
|---|---|---|---|
| `id` | uuid |  | `gen_random_uuid()` |
| `report_id` | uuid |  | → `reports` (on delete cascade) |
| `recipient` | text |  |  |
| `status` | text |  |  |
| `email_message_id` | uuid | yes |  |
| `error` | text | yes |  |
| `created_at` | timestamp with time zone |  | `now()` |

### `credit_ledger`

| Column | Type | Null | Default / reference |
|---|---|---|---|
| `id` | uuid |  | `gen_random_uuid()` |
| `org_id` | uuid |  | → `organizations` (on delete cascade) |
| `delta` | integer |  |  |
| `reason` | text |  |  |
| `report_id` | uuid | yes |  |
| `note` | text | yes |  |
| `created_at` | timestamp with time zone |  | `now()` |

Indexes: `INDEX credit_ledger_org_idx (org_id)`

### `usage_records`

| Column | Type | Null | Default / reference |
|---|---|---|---|
| `id` | uuid |  | `gen_random_uuid()` |
| `org_id` | uuid |  |  |
| `business_id` | uuid | yes |  |
| `metric` | text |  |  |
| `quantity` | integer |  |  |
| `provider` | text | yes |  |
| `detail` | jsonb | yes |  |
| `created_at` | timestamp with time zone |  | `now()` |

Indexes: `INDEX usage_org_metric_idx (org_id, metric, created_at)`

### `email_messages`

| Column | Type | Null | Default / reference |
|---|---|---|---|
| `id` | uuid |  | `gen_random_uuid()` |
| `org_id` | uuid | yes |  |
| `to` | text |  |  |
| `from_name` | text | yes |  |
| `from_email` | text | yes |  |
| `subject` | text |  |  |
| `html` | text |  |  |
| `text` | text |  |  |
| `template` | text |  |  |
| `status` | text |  | `'queued'::text` |
| `provider` | text | yes |  |
| `provider_message_id` | text | yes |  |
| `error` | text | yes |  |
| `related_type` | text | yes |  |
| `related_id` | text | yes |  |
| `attempts` | integer |  | `0` |
| `created_at` | timestamp with time zone |  | `now()` |
| `sent_at` | timestamp with time zone | yes |  |

Indexes: `INDEX email_messages_org_idx (org_id, created_at)`

### `notifications`

| Column | Type | Null | Default / reference |
|---|---|---|---|
| `id` | uuid |  | `gen_random_uuid()` |
| `org_id` | uuid |  | → `organizations` (on delete cascade) |
| `user_id` | uuid |  | → `users` (on delete cascade) |
| `business_id` | uuid | yes |  |
| `type` | text |  |  |
| `title` | text |  |  |
| `body` | text | yes |  |
| `link` | text | yes |  |
| `read_at` | timestamp with time zone | yes |  |
| `created_at` | timestamp with time zone |  | `now()` |

Indexes: `INDEX notifications_user_idx (user_id, read_at)`

### `notification_preferences`

| Column | Type | Null | Default / reference |
|---|---|---|---|
| `user_id` | uuid |  | → `users` (on delete cascade) |
| `org_id` | uuid |  | → `organizations` (on delete cascade) |
| `prefs` | jsonb |  |  |
| `updated_at` | timestamp with time zone |  | `now()` |

Indexes: `UNIQUE INDEX notification_preferences_user_id_org_id_pk (user_id, org_id)`

### `activity_events`

| Column | Type | Null | Default / reference |
|---|---|---|---|
| `id` | uuid |  | `gen_random_uuid()` |
| `org_id` | uuid |  |  |
| `business_id` | uuid | yes |  |
| `actor_type` | text |  |  |
| `actor_id` | text | yes |  |
| `action` | text |  |  |
| `target_type` | text | yes |  |
| `target_id` | text | yes |  |
| `detail` | jsonb | yes |  |
| `ip` | text | yes |  |
| `created_at` | timestamp with time zone |  | `now()` |

Indexes: `INDEX activity_business_idx (business_id, created_at)`; `INDEX activity_org_idx (org_id, created_at)`

## Enumerations

| Enum | Values |
|---|---|
