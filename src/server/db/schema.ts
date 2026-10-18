/**
 * Database schema. This file is the single source of truth for persistent
 * state; migrations in /drizzle are generated from it with `npm run db:generate`.
 *
 * Tenant model: organizations own clients, business locations, integrations and
 * everything below them. Every business-scoped table carries business_id, and
 * every org-scoped table carries org_id, so service-layer authorization can
 * always resolve a row to its tenant.
 */
import { sql } from "drizzle-orm";
import {
  bigserial,
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  date,
} from "drizzle-orm/pg-core";

const id = () => uuid("id").primaryKey().defaultRandom();
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();
const ts = (name: string) => timestamp(name, { withTimezone: true });

/* ------------------------------------------------------------------ */
/* Identity and tenancy                                                */
/* ------------------------------------------------------------------ */

export const users = pgTable(
  "users",
  {
    id: id(),
    email: text("email").notNull(),
    name: text("name").notNull(),
    passwordHash: text("password_hash"),
    googleSubject: text("google_subject"),
    emailVerifiedAt: ts("email_verified_at"),
    isPlatformAdmin: boolean("is_platform_admin").notNull().default(false),
    deactivatedAt: ts("deactivated_at"),
    lastLoginAt: ts("last_login_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("users_email_uq").on(sql`lower(${t.email})`), uniqueIndex("users_google_sub_uq").on(t.googleSubject)],
);

export const sessions = pgTable(
  "sessions",
  {
    id: text("id").primaryKey(), // sha256 of the cookie token
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    activeOrgId: uuid("active_org_id"),
    expiresAt: ts("expires_at").notNull(),
    ip: text("ip"),
    userAgent: text("user_agent"),
    createdAt: createdAt(),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

export const organizations = pgTable(
  "organizations",
  {
    id: id(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    kind: text("kind", { enum: ["agency", "business"] }).notNull().default("business"),
    plan: text("plan").notNull().default("standard"),
    limits: jsonb("limits").$type<OrgLimits>().notNull().default(sql`'{}'::jsonb`),
    status: text("status", { enum: ["active", "suspended", "closed"] }).notNull().default("active"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("organizations_slug_uq").on(t.slug)],
);

export type OrgLimits = {
  maxBusinesses?: number;
  monthlyAiRequests?: number;
  monthlyRankingPoints?: number;
  monthlyAiVisibilityQueries?: number;
  monthlyVideoRenders?: number;
};

export const clients = pgTable(
  "clients",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    contactName: text("contact_name"),
    contactEmail: text("contact_email"),
    status: text("status", { enum: ["active", "offboarded"] }).notNull().default("active"),
    notes: text("notes"),
    offboardedAt: ts("offboarded_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("clients_org_idx").on(t.orgId)],
);

export const ROLES = ["owner", "admin", "member", "client_approver"] as const;
export type Role = (typeof ROLES)[number];

export const memberships = pgTable(
  "memberships",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    role: text("role", { enum: ROLES }).notNull(),
    /** When set, the member can only see businesses belonging to these clients. */
    clientIds: uuid("client_ids").array(),
    status: text("status", { enum: ["active", "deactivated"] }).notNull().default("active"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("memberships_org_user_uq").on(t.orgId, t.userId), index("memberships_user_idx").on(t.userId)],
);

export const invitations = pgTable(
  "invitations",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    role: text("role", { enum: ROLES }).notNull(),
    clientIds: uuid("client_ids").array(),
    tokenHash: text("token_hash").notNull(),
    invitedByUserId: uuid("invited_by_user_id").references(() => users.id, { onDelete: "set null" }),
    expiresAt: ts("expires_at").notNull(),
    acceptedAt: ts("accepted_at"),
    revokedAt: ts("revoked_at"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("invitations_token_uq").on(t.tokenHash), index("invitations_org_idx").on(t.orgId)],
);

export const organizationBranding = pgTable("organization_branding", {
  orgId: uuid("org_id")
    .primaryKey()
    .references(() => organizations.id, { onDelete: "cascade" }),
  displayName: text("display_name"),
  logoUrl: text("logo_url"),
  primaryColor: text("primary_color"),
  secondaryColor: text("secondary_color"),
  supportEmail: text("support_email"),
  supportUrl: text("support_url"),
  senderName: text("sender_name"),
  senderEmail: text("sender_email"),
  senderVerifiedAt: ts("sender_verified_at"),
  reportFooter: text("report_footer"),
  updatedAt: updatedAt(),
});

export const customDomains = pgTable(
  "custom_domains",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    hostname: text("hostname").notNull(),
    purpose: text("purpose", { enum: ["app", "website"] }).notNull(),
    websiteId: uuid("website_id"),
    verificationToken: text("verification_token").notNull(),
    status: text("status", { enum: ["pending", "verified", "active", "failed", "removed"] })
      .notNull()
      .default("pending"),
    lastCheckedAt: ts("last_checked_at"),
    lastCheck: jsonb("last_check").$type<Record<string, unknown>>(),
    lastError: text("last_error"),
    verifiedAt: ts("verified_at"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("custom_domains_hostname_uq").on(t.hostname), index("custom_domains_org_idx").on(t.orgId)],
);

/* ------------------------------------------------------------------ */
/* Businesses and knowledge                                            */
/* ------------------------------------------------------------------ */

export type WeeklyHours = Partial<Record<"mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun", { open: string; close: string }[]>>;
export type ServiceArea = { places: string[]; radiusKm?: number };
export type OnboardingState = {
  steps: Record<string, { status: "todo" | "done" | "skipped"; updatedAt?: string }>;
  trustDefaultsApplied?: boolean;
};
export type BrandProfile = { primaryColor?: string; secondaryColor?: string; voice?: string; tagline?: string };

export const businessLocations = pgTable(
  "business_locations",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    clientId: uuid("client_id").references(() => clients.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    website: text("website"),
    primaryCategory: text("primary_category"),
    secondaryCategories: text("secondary_categories").array().notNull().default(sql`'{}'::text[]`),
    description: text("description"),
    phone: text("phone"),
    email: text("email"),
    appointmentUrl: text("appointment_url"),
    addressLine1: text("address_line1"),
    addressLine2: text("address_line2"),
    city: text("city"),
    region: text("region"),
    postalCode: text("postal_code"),
    country: text("country").default("US"),
    latitude: doublePrecision("latitude"),
    longitude: doublePrecision("longitude"),
    isServiceAreaBusiness: boolean("is_service_area_business").notNull().default(false),
    hideAddress: boolean("hide_address").notNull().default(false),
    serviceArea: jsonb("service_area").$type<ServiceArea>(),
    hours: jsonb("hours").$type<WeeklyHours>(),
    specialHours: jsonb("special_hours").$type<{ date: string; closed: boolean; open?: string; close?: string }[]>(),
    timezone: text("timezone").notNull().default("America/Chicago"),
    logoAssetId: uuid("logo_asset_id"),
    brand: jsonb("brand").$type<BrandProfile>(),
    averageCustomerValue: numeric("average_customer_value", { precision: 12, scale: 2 }),
    reviewSlug: text("review_slug").notNull(),
    googleReviewUrl: text("google_review_url"),
    gbpLocationName: text("gbp_location_name"),
    /** Google Maps place id, used to find this business in ranking results. */
    googlePlaceId: text("google_place_id"),
    gbpAccountName: text("gbp_account_name"),
    googleIntegrationId: uuid("google_integration_id"),
    onboarding: jsonb("onboarding").$type<OnboardingState>().notNull().default(sql`'{"steps":{}}'::jsonb`),
    onboardingCompletedAt: ts("onboarding_completed_at"),
    status: text("status", { enum: ["active", "archived"] }).notNull().default("active"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("business_org_idx").on(t.orgId),
    index("business_client_idx").on(t.clientId),
    uniqueIndex("business_review_slug_uq").on(t.reviewSlug),
  ],
);

export const businessServices = pgTable(
  "business_services",
  {
    id: id(),
    businessId: uuid("business_id").notNull().references(() => businessLocations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    category: text("category"),
    description: text("description"),
    source: text("source", { enum: ["gbp", "website", "user", "ai_suggested"] }).notNull(),
    status: text("status", { enum: ["active", "proposed_add", "proposed_remove", "rejected", "removed"] })
      .notNull()
      .default("active"),
    syncStatus: text("sync_status", { enum: ["local_only", "pending", "synced", "failed", "unsupported"] })
      .notNull()
      .default("local_only"),
    lastSyncedAt: ts("last_synced_at"),
    lastError: text("last_error"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("services_business_idx").on(t.businessId)],
);

export const businessAttributes = pgTable(
  "business_attributes",
  {
    id: id(),
    businessId: uuid("business_id").notNull().references(() => businessLocations.id, { onDelete: "cascade" }),
    attributeKey: text("attribute_key").notNull(),
    displayName: text("display_name").notNull(),
    groupName: text("group_name"),
    value: jsonb("value").$type<boolean | string | string[] | null>(),
    isFactualClaim: boolean("is_factual_claim").notNull().default(true),
    status: text("status", { enum: ["current", "suggested", "confirmed", "rejected"] }).notNull().default("suggested"),
    source: text("source", { enum: ["gbp", "user", "recommendation"] }).notNull(),
    confirmedByUserId: uuid("confirmed_by_user_id"),
    confirmedAt: ts("confirmed_at"),
    syncStatus: text("sync_status", { enum: ["local_only", "pending", "synced", "failed", "unsupported"] })
      .notNull()
      .default("local_only"),
    lastError: text("last_error"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("attributes_business_key_uq").on(t.businessId, t.attributeKey)],
);

export const KNOWLEDGE_CATEGORIES = [
  "identity",
  "contact",
  "service",
  "service_area",
  "hours",
  "pricing",
  "policy",
  "differentiator",
  "credential",
  "other",
] as const;

export const businessKnowledge = pgTable(
  "business_knowledge",
  {
    id: id(),
    businessId: uuid("business_id").notNull().references(() => businessLocations.id, { onDelete: "cascade" }),
    category: text("category", { enum: KNOWLEDGE_CATEGORIES }).notNull(),
    key: text("key").notNull(),
    value: text("value").notNull(),
    source: text("source", { enum: ["gbp", "website", "user", "import", "ai_extracted"] }).notNull(),
    sourceRef: text("source_ref"),
    /** Quoted text that supports an imported fact, shown when a person confirms it. */
    evidence: text("evidence"),
    verificationStatus: text("verification_status", { enum: ["unverified", "verified", "rejected"] })
      .notNull()
      .default("unverified"),
    isPublic: boolean("is_public").notNull().default(true),
    requiresConfirmation: boolean("requires_confirmation").notNull().default(false),
    verifiedByUserId: uuid("verified_by_user_id"),
    verifiedAt: ts("verified_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("knowledge_business_idx").on(t.businessId), uniqueIndex("knowledge_business_key_uq").on(t.businessId, t.category, t.key)],
);

export const TRAINING_CATEGORIES = [
  "general",
  "google_posts",
  "review_replies",
  "service_descriptions",
  "website_content",
  "faqs",
  "image_generation",
  "video_scripts",
  "voice_pronunciation",
  "suggested_reviews",
] as const;
export type TrainingCategory = (typeof TRAINING_CATEGORIES)[number];

export const trainingInstructions = pgTable(
  "training_instructions",
  {
    id: id(),
    businessId: uuid("business_id").notNull().references(() => businessLocations.id, { onDelete: "cascade" }),
    category: text("category", { enum: TRAINING_CATEGORIES }).notNull(),
    version: integer("version").notNull(),
    content: text("content").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    createdByUserId: uuid("created_by_user_id"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("training_business_cat_ver_uq").on(t.businessId, t.category, t.version)],
);

/* ------------------------------------------------------------------ */
/* Integrations                                                        */
/* ------------------------------------------------------------------ */

export const INTEGRATION_PROVIDERS = [
  "google",
  "facebook",
  "instagram",
  "linkedin",
  "youtube",
  "companycam",
] as const;
export type IntegrationProvider = (typeof INTEGRATION_PROVIDERS)[number];

export const integrations = pgTable(
  "integrations",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    clientId: uuid("client_id").references(() => clients.id, { onDelete: "set null" }),
    provider: text("provider", { enum: INTEGRATION_PROVIDERS }).notNull(),
    externalAccountId: text("external_account_id").notNull(),
    externalAccountName: text("external_account_name"),
    scopes: text("scopes").array().notNull().default(sql`'{}'::text[]`),
    accessTokenEnc: text("access_token_enc"),
    refreshTokenEnc: text("refresh_token_enc"),
    tokenExpiresAt: ts("token_expires_at"),
    status: text("status", { enum: ["active", "expired", "revoked", "error"] }).notNull().default("active"),
    lastError: text("last_error"),
    lastHealthCheckAt: ts("last_health_check_at"),
    lastSuccessAt: ts("last_success_at"),
    connectedByUserId: uuid("connected_by_user_id"),
    connectedVia: text("connected_via", { enum: ["user", "client_invite"] }).notNull().default("user"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("integrations_org_provider_account_uq").on(t.orgId, t.provider, t.externalAccountId)],
);

export const PUBLISH_TARGET_TYPES = [
  "gbp_location",
  "facebook_page",
  "instagram_account",
  "linkedin_organization",
  "youtube_channel",
  "companycam_project_source",
] as const;

export const integrationTargets = pgTable(
  "integration_targets",
  {
    id: id(),
    businessId: uuid("business_id").notNull().references(() => businessLocations.id, { onDelete: "cascade" }),
    integrationId: uuid("integration_id").notNull().references(() => integrations.id, { onDelete: "cascade" }),
    targetType: text("target_type", { enum: PUBLISH_TARGET_TYPES }).notNull(),
    externalId: text("external_id").notNull(),
    externalName: text("external_name"),
    enabled: boolean("enabled").notNull().default(true),
    lastPublishAt: ts("last_publish_at"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("targets_business_type_ext_uq").on(t.businessId, t.targetType, t.externalId)],
);

export const oauthStates = pgTable("oauth_states", {
  id: text("id").primaryKey(), // random state value
  orgId: uuid("org_id").notNull(),
  userId: uuid("user_id"),
  provider: text("provider").notNull(),
  businessId: uuid("business_id"),
  connectionInviteId: uuid("connection_invite_id"),
  codeVerifier: text("code_verifier"),
  redirectTo: text("redirect_to"),
  expiresAt: ts("expires_at").notNull(),
  createdAt: createdAt(),
});

export const connectionInvites = pgTable(
  "connection_invites",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    clientId: uuid("client_id").references(() => clients.id, { onDelete: "cascade" }),
    businessId: uuid("business_id").references(() => businessLocations.id, { onDelete: "cascade" }),
    provider: text("provider", { enum: INTEGRATION_PROVIDERS }).notNull(),
    tokenHash: text("token_hash").notNull(),
    recipientEmail: text("recipient_email"),
    expiresAt: ts("expires_at").notNull(),
    usedAt: ts("used_at"),
    revokedAt: ts("revoked_at"),
    outcome: text("outcome"),
    createdByUserId: uuid("created_by_user_id"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("connection_invites_token_uq").on(t.tokenHash)],
);

/* ------------------------------------------------------------------ */
/* Keywords, ranking audits, competitors                               */
/* ------------------------------------------------------------------ */

export const keywords = pgTable(
  "keywords",
  {
    id: id(),
    businessId: uuid("business_id").notNull().references(() => businessLocations.id, { onDelete: "cascade" }),
    phrase: text("phrase").notNull(),
    normalized: text("normalized").notNull(),
    intent: text("intent", { enum: ["discovery", "comparison", "branded", "transactional", "informational"] })
      .notNull()
      .default("discovery"),
    serviceId: uuid("service_id").references(() => businessServices.id, { onDelete: "set null" }),
    city: text("city"),
    priority: integer("priority").notNull().default(3),
    isTracked: boolean("is_tracked").notNull().default(true),
    source: text("source", { enum: ["user", "suggested"] }).notNull().default("user"),
    demandEstimate: integer("demand_estimate"),
    demandSource: text("demand_source"),
    demandAsOf: ts("demand_as_of"),
    archivedAt: ts("archived_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("keywords_business_norm_city_uq").on(t.businessId, t.normalized, sql`coalesce(${t.city}, '')`)],
);

export const keywordDemandHistory = pgTable("keyword_demand_history", {
  id: id(),
  keywordId: uuid("keyword_id").notNull().references(() => keywords.id, { onDelete: "cascade" }),
  estimate: integer("estimate"),
  source: text("source").notNull(),
  isDemo: boolean("is_demo").notNull().default(false),
  observedAt: ts("observed_at").notNull().defaultNow(),
});

export const auditConfigurations = pgTable(
  "audit_configurations",
  {
    id: id(),
    businessId: uuid("business_id").notNull().references(() => businessLocations.id, { onDelete: "cascade" }),
    keywordId: uuid("keyword_id").notNull().references(() => keywords.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    centerLat: doublePrecision("center_lat").notNull(),
    centerLng: doublePrecision("center_lng").notNull(),
    radiusKm: doublePrecision("radius_km").notNull(),
    gridSize: integer("grid_size").notNull(),
    device: text("device", { enum: ["desktop", "mobile"] }).notNull().default("mobile"),
    language: text("language").notNull().default("en"),
    provider: text("provider").notNull(),
    isCurrent: boolean("is_current").notNull().default(true),
    changeNote: text("change_note"),
    createdByUserId: uuid("created_by_user_id"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("audit_config_keyword_version_uq").on(t.keywordId, t.version)],
);

export const rankingAudits = pgTable(
  "ranking_audits",
  {
    id: id(),
    businessId: uuid("business_id").notNull().references(() => businessLocations.id, { onDelete: "cascade" }),
    configurationId: uuid("configuration_id").notNull().references(() => auditConfigurations.id, { onDelete: "restrict" }),
    status: text("status", { enum: ["queued", "running", "completed", "partial", "failed"] }).notNull().default("queued"),
    provider: text("provider").notNull(),
    isDemo: boolean("is_demo").notNull().default(false),
    trigger: text("trigger", { enum: ["manual", "schedule"] }).notNull().default("manual"),
    pointsTotal: integer("points_total").notNull().default(0),
    pointsSucceeded: integer("points_succeeded").notNull().default(0),
    stats: jsonb("stats").$type<Record<string, number | null>>(),
    error: text("error"),
    startedAt: ts("started_at"),
    completedAt: ts("completed_at"),
    createdAt: createdAt(),
  },
  (t) => [index("ranking_audits_business_idx").on(t.businessId, t.createdAt)],
);

export type ObservedListing = { placeId: string; name: string; rank: number; rating?: number; reviewCount?: number; address?: string };

export const rankingObservations = pgTable(
  "ranking_observations",
  {
    id: id(),
    auditId: uuid("audit_id").notNull().references(() => rankingAudits.id, { onDelete: "cascade" }),
    pointIndex: integer("point_index").notNull(),
    lat: doublePrecision("lat").notNull(),
    lng: doublePrecision("lng").notNull(),
    status: text("status", { enum: ["found", "not_found", "failed"] }).notNull(),
    rank: integer("rank"),
    matchedPlaceId: text("matched_place_id"),
    results: jsonb("results").$type<ObservedListing[]>(),
    error: text("error"),
    providerRef: text("provider_ref"),
    observedAt: ts("observed_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("ranking_obs_audit_point_uq").on(t.auditId, t.pointIndex)],
);

export const competitors = pgTable(
  "competitors",
  {
    id: id(),
    businessId: uuid("business_id").notNull().references(() => businessLocations.id, { onDelete: "cascade" }),
    placeId: text("place_id").notNull(),
    name: text("name").notNull(),
    address: text("address"),
    isTracked: boolean("is_tracked").notNull().default(false),
    firstSeenAt: ts("first_seen_at").notNull().defaultNow(),
    lastSeenAt: ts("last_seen_at").notNull().defaultNow(),
    isDemo: boolean("is_demo").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("competitors_business_place_uq").on(t.businessId, t.placeId)],
);

export const competitorSnapshots = pgTable("competitor_snapshots", {
  id: id(),
  competitorId: uuid("competitor_id").notNull().references(() => competitors.id, { onDelete: "cascade" }),
  auditId: uuid("audit_id").references(() => rankingAudits.id, { onDelete: "cascade" }),
  keywordId: uuid("keyword_id").references(() => keywords.id, { onDelete: "cascade" }),
  appearances: integer("appearances").notNull().default(0),
  averageRank: doublePrecision("average_rank"),
  top3Count: integer("top3_count").notNull().default(0),
  rating: doublePrecision("rating"),
  reviewCount: integer("review_count"),
  capturedAt: ts("captured_at").notNull().defaultNow(),
});

/* ------------------------------------------------------------------ */
/* Profile optimization                                                */
/* ------------------------------------------------------------------ */

export const profileRecommendations = pgTable(
  "profile_recommendations",
  {
    id: id(),
    businessId: uuid("business_id").notNull().references(() => businessLocations.id, { onDelete: "cascade" }),
    field: text("field").notNull(),
    issue: text("issue").notNull(),
    currentValue: jsonb("current_value"),
    proposedValue: jsonb("proposed_value"),
    reason: text("reason").notNull(),
    impact: text("impact", { enum: ["high", "medium", "low"] }).notNull(),
    confidence: doublePrecision("confidence").notNull(),
    autoApplicable: boolean("auto_applicable").notNull().default(false),
    requiresFactConfirmation: boolean("requires_fact_confirmation").notNull().default(false),
    status: text("status", { enum: ["open", "approved", "applied", "rejected", "failed", "superseded"] })
      .notNull()
      .default("open"),
    nextAction: text("next_action"),
    taskId: uuid("task_id"),
    applyResult: jsonb("apply_result").$type<Record<string, unknown>>(),
    appliedAt: ts("applied_at"),
    generation: jsonb("generation").$type<Record<string, unknown>>(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("profile_recs_business_idx").on(t.businessId, t.status)],
);

export const profileChanges = pgTable(
  "profile_changes",
  {
    id: id(),
    businessId: uuid("business_id").notNull().references(() => businessLocations.id, { onDelete: "cascade" }),
    field: text("field").notNull(),
    before: jsonb("before"),
    after: jsonb("after"),
    origin: text("origin", { enum: ["user", "recommendation", "sync", "onboarding"] }).notNull(),
    actorUserId: uuid("actor_user_id"),
    syncStatus: text("sync_status", { enum: ["local_only", "pending", "synced", "verified", "failed", "unsupported"] })
      .notNull()
      .default("local_only"),
    syncedAt: ts("synced_at"),
    syncError: text("sync_error"),
    createdAt: createdAt(),
  },
  (t) => [index("profile_changes_business_idx").on(t.businessId, t.createdAt)],
);

export const optimizationScores = pgTable("optimization_scores", {
  id: id(),
  businessId: uuid("business_id").notNull().references(() => businessLocations.id, { onDelete: "cascade" }),
  score: integer("score").notNull(),
  breakdown: jsonb("breakdown").$type<{ key: string; label: string; earned: number; possible: number; detail: string }[]>().notNull(),
  computedAt: ts("computed_at").notNull().defaultNow(),
});

/* ------------------------------------------------------------------ */
/* Reviews and reputation                                              */
/* ------------------------------------------------------------------ */

export const reviews = pgTable(
  "reviews",
  {
    id: id(),
    businessId: uuid("business_id").notNull().references(() => businessLocations.id, { onDelete: "cascade" }),
    source: text("source", { enum: ["google", "demo"] }).notNull(),
    externalId: text("external_id").notNull(),
    reviewerName: text("reviewer_name"),
    rating: integer("rating").notNull(),
    text: text("text"),
    publishedAt: ts("published_at").notNull(),
    ownerReply: text("owner_reply"),
    ownerReplyAt: ts("owner_reply_at"),
    replyStatus: text("reply_status", {
      enum: ["unanswered", "drafting", "pending_approval", "approved", "publishing", "published", "ignored", "failed", "escalated"],
    })
      .notNull()
      .default("unanswered"),
    policyApplied: text("policy_applied"),
    sentiment: text("sentiment", { enum: ["positive", "neutral", "negative", "mixed"] }),
    analysis: jsonb("analysis").$type<{ praise?: string[]; complaints?: string[]; requestedResolution?: string | null }>(),
    isDemo: boolean("is_demo").notNull().default(false),
    fetchedAt: ts("fetched_at").notNull().defaultNow(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("reviews_business_source_ext_uq").on(t.businessId, t.source, t.externalId), index("reviews_business_published_idx").on(t.businessId, t.publishedAt)],
);

export const reviewReplies = pgTable(
  "review_replies",
  {
    id: id(),
    reviewId: uuid("review_id").notNull().references(() => reviews.id, { onDelete: "cascade" }),
    businessId: uuid("business_id").notNull().references(() => businessLocations.id, { onDelete: "cascade" }),
    content: text("content").notNull(),
    origin: text("origin", { enum: ["ai", "template", "manual"] }).notNull(),
    status: text("status", { enum: ["draft", "pending_approval", "approved", "publishing", "published", "rejected", "failed", "superseded"] })
      .notNull()
      .default("draft"),
    validation: jsonb("validation").$type<ValidationResult>(),
    generation: jsonb("generation").$type<Record<string, unknown>>(),
    taskId: uuid("task_id"),
    publicationJobId: uuid("publication_job_id"),
    publishedAt: ts("published_at"),
    createdByUserId: uuid("created_by_user_id"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("review_replies_review_idx").on(t.reviewId)],
);

export type ValidationIssue = { code: string; severity: "error" | "warning"; message: string };
export type ValidationResult = { ok: boolean; issues: ValidationIssue[] };

export const REVIEW_MODES = ["auto", "approval", "template", "ignore"] as const;
export type ReviewMode = (typeof REVIEW_MODES)[number];

export const reviewPolicies = pgTable(
  "review_policies",
  {
    businessId: uuid("business_id").notNull().references(() => businessLocations.id, { onDelete: "cascade" }),
    rating: integer("rating").notNull(),
    mode: text("mode", { enum: REVIEW_MODES }).notNull(),
    templateId: uuid("template_id"),
    templateRequiresApproval: boolean("template_requires_approval").notNull().default(false),
    escalate: boolean("escalate").notNull().default(false),
    updatedAt: updatedAt(),
  },
  (t) => [primaryKey({ columns: [t.businessId, t.rating] })],
);

export const reviewTemplates = pgTable("review_templates", {
  id: id(),
  businessId: uuid("business_id").notNull().references(() => businessLocations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  body: text("body").notNull(),
  createdAt: createdAt(),
});

export const reviewReports = pgTable("review_reports", {
  id: id(),
  reviewId: uuid("review_id").notNull().references(() => reviews.id, { onDelete: "cascade" }),
  businessId: uuid("business_id").notNull().references(() => businessLocations.id, { onDelete: "cascade" }),
  reason: text("reason").notNull(),
  evidence: text("evidence"),
  detectedSignals: jsonb("detected_signals").$type<string[]>(),
  status: text("status", { enum: ["draft", "submitted", "removed", "kept", "unknown"] }).notNull().default("draft"),
  submissionMethod: text("submission_method"),
  submittedAt: ts("submitted_at"),
  submittedByUserId: uuid("submitted_by_user_id"),
  outcomeAt: ts("outcome_at"),
  notes: text("notes"),
  createdAt: createdAt(),
});

export const reviewLinks = pgTable(
  "review_links",
  {
    id: id(),
    businessId: uuid("business_id").notNull().references(() => businessLocations.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    label: text("label").notNull(),
    salesperson: text("salesperson"),
    service: text("service"),
    campaignId: uuid("campaign_id"),
    photoBoostEnabled: boolean("photo_boost_enabled").notNull().default(true),
    archivedAt: ts("archived_at"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("review_links_business_slug_uq").on(t.businessId, t.slug)],
);

export const reviewLinkEvents = pgTable(
  "review_link_events",
  {
    id: id(),
    linkId: uuid("link_id").references(() => reviewLinks.id, { onDelete: "cascade" }),
    businessId: uuid("business_id").notNull().references(() => businessLocations.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id"),
    type: text("type", { enum: ["open", "continue_to_google", "photo_uploaded", "photo_skipped", "opt_out", "private_feedback"] }).notNull(),
    meta: jsonb("meta").$type<Record<string, unknown>>(),
    createdAt: createdAt(),
  },
  (t) => [index("review_link_events_business_idx").on(t.businessId, t.createdAt)],
);

export const reviewCampaigns = pgTable("review_campaigns", {
  id: id(),
  businessId: uuid("business_id").notNull().references(() => businessLocations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  status: text("status", { enum: ["draft", "validated", "scheduled", "sending", "paused", "completed", "failed"] })
    .notNull()
    .default("draft"),
  channel: text("channel", { enum: ["email"] }).notNull().default("email"),
  subject: text("subject").notNull(),
  messageTemplate: text("message_template").notNull(),
  followUp: jsonb("follow_up").$type<{ enabled: boolean; delayDays: number; maxFollowUps: number; messageTemplate?: string }>().notNull(),
  dailyLimit: integer("daily_limit").notNull().default(50),
  sendWindow: jsonb("send_window").$type<{ startHour: number; endHour: number }>().notNull(),
  startAt: ts("start_at"),
  linkId: uuid("link_id"),
  createdByUserId: uuid("created_by_user_id"),
  pausedAt: ts("paused_at"),
  completedAt: ts("completed_at"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const campaignContacts = pgTable(
  "campaign_contacts",
  {
    id: id(),
    campaignId: uuid("campaign_id").notNull().references(() => reviewCampaigns.id, { onDelete: "cascade" }),
    businessId: uuid("business_id").notNull().references(() => businessLocations.id, { onDelete: "cascade" }),
    name: text("name"),
    email: text("email"),
    emailNormalized: text("email_normalized"),
    phone: text("phone"),
    serviceLabel: text("service_label"),
    salesperson: text("salesperson"),
    status: text("status", {
      enum: ["pending", "invalid", "duplicate", "suppressed", "enrolled", "sent", "followed_up", "clicked", "completed", "failed", "opted_out"],
    })
      .notNull()
      .default("pending"),
    validationErrors: text("validation_errors").array(),
    sends: integer("sends").notNull().default(0),
    enrolledAt: ts("enrolled_at"),
    lastSentAt: ts("last_sent_at"),
    nextSendAt: ts("next_send_at"),
    clickedAt: ts("clicked_at"),
    optOutToken: text("opt_out_token").notNull(),
    lastError: text("last_error"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("campaign_contacts_email_uq").on(t.campaignId, t.emailNormalized),
    index("campaign_contacts_due_idx").on(t.campaignId, t.status, t.nextSendAt),
    uniqueIndex("campaign_contacts_optout_uq").on(t.optOutToken),
  ],
);

export const suppressions = pgTable(
  "suppressions",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    businessId: uuid("business_id").references(() => businessLocations.id, { onDelete: "cascade" }),
    emailNormalized: text("email_normalized").notNull(),
    reason: text("reason", { enum: ["opt_out", "bounce", "complaint", "manual"] }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("suppressions_org_email_uq").on(t.orgId, t.emailNormalized)],
);

/* ------------------------------------------------------------------ */
/* Media                                                               */
/* ------------------------------------------------------------------ */

export const mediaAssets = pgTable(
  "media_assets",
  {
    id: id(),
    businessId: uuid("business_id").notNull().references(() => businessLocations.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["image", "video", "audio"] }).notNull(),
    source: text("source", { enum: ["upload", "upload_link", "gbp", "companycam", "photo_boost", "ai_generated", "render", "branded"] }).notNull(),
    storageKey: text("storage_key").notNull(),
    mime: text("mime").notNull(),
    bytes: integer("bytes").notNull(),
    width: integer("width"),
    height: integer("height"),
    durationMs: integer("duration_ms"),
    sha256: text("sha256").notNull(),
    perceptualHash: text("perceptual_hash"),
    originalFilename: text("original_filename"),
    seoFilename: text("seo_filename"),
    altText: text("alt_text"),
    description: text("description"),
    descriptionSource: text("description_source", { enum: ["user", "ai", "none"] }).notNull().default("none"),
    /** Coordinates genuinely present in the file's EXIF data. Never synthesized. */
    exifLat: doublePrecision("exif_lat"),
    exifLng: doublePrecision("exif_lng"),
    exifTakenAt: ts("exif_taken_at"),
    exif: jsonb("exif").$type<Record<string, unknown>>(),
    /** Business/service-area association chosen by a person, kept separate from capture data. */
    assocLabel: text("assoc_label"),
    assocLat: doublePrecision("assoc_lat"),
    assocLng: doublePrecision("assoc_lng"),
    uploadedByUserId: uuid("uploaded_by_user_id"),
    contributorName: text("contributor_name"),
    contributorEmail: text("contributor_email"),
    consent: jsonb("consent").$type<{ marketingUse: boolean; capturedAt: string; text: string }>(),
    attribution: text("attribution"),
    externalRef: text("external_ref"),
    moderationStatus: text("moderation_status", { enum: ["pending", "approved", "rejected"] }).notNull().default("approved"),
    moderationNotes: text("moderation_notes"),
    useForPosts: boolean("use_for_posts").notNull().default(true),
    useForWebsite: boolean("use_for_website").notNull().default(true),
    useForVideos: boolean("use_for_videos").notNull().default(true),
    useForGoogleMedia: boolean("use_for_google_media").notNull().default(true),
    tags: text("tags").array().notNull().default(sql`'{}'::text[]`),
    isAiGenerated: boolean("is_ai_generated").notNull().default(false),
    parentAssetId: uuid("parent_asset_id"),
    deletedAt: ts("deleted_at"),
    createdAt: createdAt(),
  },
  (t) => [
    index("media_business_idx").on(t.businessId, t.createdAt),
    uniqueIndex("media_business_sha_uq").on(t.businessId, t.sha256),
  ],
);

export const mediaVariants = pgTable(
  "media_variants",
  {
    id: id(),
    assetId: uuid("asset_id").notNull().references(() => mediaAssets.id, { onDelete: "cascade" }),
    variant: text("variant", { enum: ["thumb", "web", "square"] }).notNull(),
    storageKey: text("storage_key").notNull(),
    mime: text("mime").notNull(),
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    bytes: integer("bytes").notNull(),
  },
  (t) => [uniqueIndex("media_variant_uq").on(t.assetId, t.variant)],
);

export const mediaUsages = pgTable(
  "media_usages",
  {
    id: id(),
    assetId: uuid("asset_id").notNull().references(() => mediaAssets.id, { onDelete: "cascade" }),
    businessId: uuid("business_id").notNull().references(() => businessLocations.id, { onDelete: "cascade" }),
    usageType: text("usage_type", { enum: ["post", "video", "website", "gbp_media"] }).notNull(),
    refId: uuid("ref_id"),
    usedAt: ts("used_at").notNull().defaultNow(),
  },
  (t) => [index("media_usages_asset_idx").on(t.assetId, t.usedAt)],
);

export const uploadLinks = pgTable(
  "upload_links",
  {
    id: id(),
    businessId: uuid("business_id").notNull().references(() => businessLocations.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    label: text("label").notNull(),
    requireApproval: boolean("require_approval").notNull().default(true),
    expiresAt: ts("expires_at").notNull(),
    revokedAt: ts("revoked_at"),
    uploadsCount: integer("uploads_count").notNull().default(0),
    createdByUserId: uuid("created_by_user_id"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("upload_links_token_uq").on(t.tokenHash)],
);

/* ------------------------------------------------------------------ */
/* Content, publishing, tasks                                          */
/* ------------------------------------------------------------------ */

export const CONTENT_TYPES = ["gbp_post", "faq", "service_description", "business_description", "video_script", "website_section"] as const;
export const CONTENT_STATUSES = [
  "draft",
  "pending_approval",
  "approved",
  "scheduled",
  "publishing",
  "published",
  "partially_published",
  "failed",
  "rejected",
  "skipped",
] as const;
export type ContentStatus = (typeof CONTENT_STATUSES)[number];

export const contentItems = pgTable(
  "content_items",
  {
    id: id(),
    businessId: uuid("business_id").notNull().references(() => businessLocations.id, { onDelete: "cascade" }),
    type: text("type", { enum: CONTENT_TYPES }).notNull(),
    title: text("title"),
    body: text("body").notNull(),
    ctaType: text("cta_type"),
    ctaUrl: text("cta_url"),
    mediaAssetId: uuid("media_asset_id"),
    imageMode: text("image_mode", { enum: ["none", "raw", "branded"] }).notNull().default("none"),
    branding: jsonb("branding").$type<BrandingOptions>(),
    imageSource: text("image_source", { enum: ["none", "uploaded", "gbp", "ai_generated"] }).notNull().default("none"),
    destinations: text("destinations").array().notNull().default(sql`'{google}'::text[]`),
    status: text("status", { enum: CONTENT_STATUSES }).notNull().default("draft"),
    scheduledFor: ts("scheduled_for"),
    approvalRequired: boolean("approval_required").notNull().default(false),
    approvalReason: text("approval_reason"),
    holiday: text("holiday"),
    contentHash: text("content_hash").notNull(),
    validation: jsonb("validation").$type<ValidationResult>(),
    generation: jsonb("generation").$type<Record<string, unknown>>(),
    automationExecutionId: uuid("automation_execution_id"),
    taskId: uuid("task_id"),
    createdByUserId: uuid("created_by_user_id"),
    publishedAt: ts("published_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("content_business_status_idx").on(t.businessId, t.type, t.status), index("content_scheduled_idx").on(t.status, t.scheduledFor)],
);

export type BrandingOptions = {
  logoPosition: "top-left" | "top-right" | "bottom-left" | "bottom-right" | "none";
  textPosition: "top" | "center" | "bottom";
  cta: string;
  customCta?: string;
  overlayOpacity: number;
};

export const publicationJobs = pgTable(
  "publication_jobs",
  {
    id: id(),
    businessId: uuid("business_id").notNull().references(() => businessLocations.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["gbp_post", "social_post", "review_reply", "video", "gbp_profile_update", "website_publish"] }).notNull(),
    refType: text("ref_type").notNull(),
    refId: uuid("ref_id").notNull(),
    destination: text("destination", { enum: ["google", "facebook", "instagram", "linkedin", "youtube", "website"] }).notNull(),
    targetId: uuid("target_id"),
    requestedFor: ts("requested_for").notNull(),
    lastAttemptAt: ts("last_attempt_at"),
    completedAt: ts("completed_at"),
    attempts: integer("attempts").notNull().default(0),
    status: text("status", { enum: ["queued", "in_progress", "succeeded", "failed", "cancelled", "blocked"] }).notNull().default("queued"),
    idempotencyKey: text("idempotency_key").notNull(),
    providerId: text("provider_id"),
    providerUrl: text("provider_url"),
    providerResponse: jsonb("provider_response").$type<Record<string, unknown>>(),
    lastError: text("last_error"),
    isDemo: boolean("is_demo").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("publication_jobs_idem_uq").on(t.idempotencyKey), index("publication_jobs_ref_idx").on(t.refType, t.refId)],
);

export const TASK_TYPES = ["post", "review_reply", "video", "website", "photo", "recommendation", "faq", "report", "integration", "review_report", "other"] as const;
export const TASK_STATUSES = ["open", "approved", "rejected", "skipped", "completed", "expired", "cancelled"] as const;
export type TaskType = (typeof TASK_TYPES)[number];
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const tasks = pgTable(
  "tasks",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    businessId: uuid("business_id").notNull().references(() => businessLocations.id, { onDelete: "cascade" }),
    type: text("type", { enum: TASK_TYPES }).notNull(),
    title: text("title").notNull(),
    summary: text("summary"),
    refType: text("ref_type").notNull(),
    refId: uuid("ref_id").notNull(),
    status: text("status", { enum: TASK_STATUSES }).notNull().default("open"),
    kind: text("kind", { enum: ["approval", "action"] }).notNull().default("approval"),
    assigneeUserId: uuid("assignee_user_id"),
    assigneeEmail: text("assignee_email"),
    notificationRecipients: text("notification_recipients").array().notNull().default(sql`'{}'::text[]`),
    visibleInDashboard: boolean("visible_in_dashboard").notNull().default(true),
    clientCanApprove: boolean("client_can_approve").notNull().default(true),
    dueAt: ts("due_at"),
    createdBy: text("created_by").notNull().default("system"),
    resolvedAt: ts("resolved_at"),
    resolvedBy: text("resolved_by"),
    resolutionNote: text("resolution_note"),
    outcome: jsonb("outcome").$type<Record<string, unknown>>(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("tasks_org_status_idx").on(t.orgId, t.status),
    index("tasks_business_idx").on(t.businessId, t.status),
    uniqueIndex("tasks_open_ref_uq").on(t.refType, t.refId).where(sql`status = 'open'`),
  ],
);

export const taskEvents = pgTable(
  "task_events",
  {
    id: id(),
    taskId: uuid("task_id").notNull().references(() => tasks.id, { onDelete: "cascade" }),
    action: text("action").notNull(),
    actorType: text("actor_type", { enum: ["user", "approval_link", "system"] }).notNull(),
    actorId: text("actor_id"),
    detail: jsonb("detail").$type<Record<string, unknown>>(),
    createdAt: createdAt(),
  },
  (t) => [index("task_events_task_idx").on(t.taskId)],
);

export const approvalTokens = pgTable(
  "approval_tokens",
  {
    id: id(),
    taskId: uuid("task_id").notNull().references(() => tasks.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    recipientEmail: text("recipient_email").notNull(),
    allowedActions: text("allowed_actions").array().notNull(),
    expiresAt: ts("expires_at").notNull(),
    usedAt: ts("used_at"),
    revokedAt: ts("revoked_at"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("approval_tokens_hash_uq").on(t.tokenHash), index("approval_tokens_task_idx").on(t.taskId)],
);

/* ------------------------------------------------------------------ */
/* Automations and the job queue                                       */
/* ------------------------------------------------------------------ */

export const AUTOMATION_TYPES = [
  "posting",
  "review_replies",
  "historical_reviews",
  "review_requests",
  "faq_generation",
  "website_updates",
  "video_generation",
  "reporting",
  "ranking_audit",
  "ai_visibility_audit",
  "integration_health",
  "account_manager",
] as const;
export type AutomationType = (typeof AUTOMATION_TYPES)[number];

export type AutomationSchedule = {
  frequency: "hourly" | "daily" | "weekly" | "monthly";
  /** Local time in the business timezone, HH:MM */
  time: string;
  /** 0=Sunday .. 6=Saturday, used for weekly */
  daysOfWeek?: number[];
  /** 1..28, used for monthly */
  dayOfMonth?: number;
  /** Run every N periods (e.g. every 2 weeks). */
  interval?: number;
};

export const automationRules = pgTable(
  "automation_rules",
  {
    id: id(),
    businessId: uuid("business_id").notNull().references(() => businessLocations.id, { onDelete: "cascade" }),
    type: text("type", { enum: AUTOMATION_TYPES }).notNull(),
    enabled: boolean("enabled").notNull().default(false),
    schedule: jsonb("schedule").$type<AutomationSchedule>().notNull(),
    config: jsonb("config").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    approvalMode: text("approval_mode").notNull().default("all"),
    notificationRecipients: text("notification_recipients").array().notNull().default(sql`'{}'::text[]`),
    showTasksInDashboard: boolean("show_tasks_in_dashboard").notNull().default(true),
    maxRetries: integer("max_retries").notNull().default(3),
    lastRunAt: ts("last_run_at"),
    nextRunAt: ts("next_run_at"),
    lastSuccessAt: ts("last_success_at"),
    lastFailureAt: ts("last_failure_at"),
    lastError: text("last_error"),
    consecutiveFailures: integer("consecutive_failures").notNull().default(0),
    updatedByUserId: uuid("updated_by_user_id"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("automation_rules_business_type_uq").on(t.businessId, t.type), index("automation_rules_due_idx").on(t.enabled, t.nextRunAt)],
);

export const automationExecutions = pgTable(
  "automation_executions",
  {
    id: id(),
    ruleId: uuid("rule_id").notNull().references(() => automationRules.id, { onDelete: "cascade" }),
    businessId: uuid("business_id").notNull().references(() => businessLocations.id, { onDelete: "cascade" }),
    trigger: text("trigger", { enum: ["schedule", "manual", "event"] }).notNull(),
    status: text("status", { enum: ["queued", "running", "succeeded", "partial", "failed", "skipped"] }).notNull().default("queued"),
    scheduledFor: ts("scheduled_for").notNull(),
    startedAt: ts("started_at"),
    finishedAt: ts("finished_at"),
    summary: jsonb("summary").$type<Record<string, unknown>>(),
    error: text("error"),
    idempotencyKey: text("idempotency_key").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("automation_exec_idem_uq").on(t.idempotencyKey), index("automation_exec_rule_idx").on(t.ruleId, t.createdAt)],
);

export const jobs = pgTable(
  "jobs",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    queue: text("queue").notNull().default("default"),
    name: text("name").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    status: text("status", { enum: ["pending", "running", "completed", "failed", "dead", "cancelled"] }).notNull().default("pending"),
    runAt: ts("run_at").notNull().defaultNow(),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(5),
    backoffBaseMs: integer("backoff_base_ms").notNull().default(30000),
    timeoutMs: integer("timeout_ms").notNull().default(300000),
    lockedBy: text("locked_by"),
    lockedAt: ts("locked_at"),
    lastError: text("last_error"),
    result: jsonb("result").$type<Record<string, unknown>>(),
    idempotencyKey: text("idempotency_key"),
    orgId: uuid("org_id"),
    businessId: uuid("business_id"),
    createdAt: createdAt(),
    completedAt: ts("completed_at"),
  },
  (t) => [
    index("jobs_pending_idx").on(t.queue, t.status, t.runAt),
    uniqueIndex("jobs_idem_uq").on(t.idempotencyKey),
    index("jobs_business_idx").on(t.businessId, t.createdAt),
  ],
);

/* ------------------------------------------------------------------ */
/* Video studio                                                        */
/* ------------------------------------------------------------------ */

export type VideoSettings = {
  bRoll: boolean;
  bRollMax: number;
  textOverlay: boolean;
  imageEffects: boolean;
  logoWatermark: boolean;
  introLogo: boolean;
  music: string; // track id or "auto" or "none"
  musicVolume: number;
  voiceIds: string[];
  voiceDirection?: string;
  endingText?: string;
  /** Set by the video automation; manual projects always require approval. */
  approvalMode?: "none" | "all";
};

export const videoProjects = pgTable("video_projects", {
  id: id(),
  businessId: uuid("business_id").notNull().references(() => businessLocations.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  format: text("format", { enum: ["vertical", "horizontal"] }).notNull().default("vertical"),
  status: text("status", { enum: ["draft", "rendering", "rendered", "pending_approval", "approved", "publishing", "published", "failed"] })
    .notNull()
    .default("draft"),
  settings: jsonb("settings").$type<VideoSettings>().notNull(),
  brief: text("brief"),
  destinations: text("destinations").array().notNull().default(sql`'{}'::text[]`),
  outputAssetId: uuid("output_asset_id"),
  previewAssetId: uuid("preview_asset_id"),
  renderedRevision: integer("rendered_revision"),
  revision: integer("revision").notNull().default(1),
  renderError: text("render_error"),
  renderLog: jsonb("render_log").$type<Record<string, unknown>>(),
  taskId: uuid("task_id"),
  createdByUserId: uuid("created_by_user_id"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const videoScenes = pgTable(
  "video_scenes",
  {
    id: id(),
    projectId: uuid("project_id").notNull().references(() => videoProjects.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    mediaAssetId: uuid("media_asset_id"),
    isBRoll: boolean("is_b_roll").notNull().default(false),
    narration: text("narration").notNull().default(""),
    voiceId: text("voice_id"),
    deliveryInstruction: text("delivery_instruction"),
    pronunciationOverrides: jsonb("pronunciation_overrides").$type<{ term: string; say: string }[]>(),
    overlayText: text("overlay_text"),
    durationMs: integer("duration_ms").notNull().default(4000),
    transition: text("transition", { enum: ["cut", "fade", "slide"] }).notNull().default("fade"),
    effect: text("effect", { enum: ["none", "zoom_in", "zoom_out", "pan"] }).notNull().default("zoom_in"),
    audioAssetId: uuid("audio_asset_id"),
    audioHash: text("audio_hash"),
    segmentAssetId: uuid("segment_asset_id"),
    segmentHash: text("segment_hash"),
    updatedAt: updatedAt(),
  },
  (t) => [index("video_scenes_project_idx").on(t.projectId, t.position)],
);

/* ------------------------------------------------------------------ */
/* Websites and Website & AI SEO                                       */
/* ------------------------------------------------------------------ */

export type SiteSection = {
  id: string;
  type: string;
  data: Record<string, unknown>;
  /** Fields a person edited by hand; regeneration never overwrites them. */
  manualFields?: string[];
  updatedAt?: string;
};

export const websites = pgTable(
  "websites",
  {
    id: id(),
    businessId: uuid("business_id").notNull().references(() => businessLocations.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    theme: jsonb("theme").$type<{ primaryColor: string; accentColor: string; font: string }>().notNull(),
    status: text("status", { enum: ["draft", "generating", "ready", "published", "failed"] }).notNull().default("draft"),
    publishedRevisionId: uuid("published_revision_id"),
    publishedAt: ts("published_at"),
    customDomainId: uuid("custom_domain_id"),
    settings: jsonb("settings").$type<{ robotsAllowIndexing: boolean; widgets: { reviews: boolean; gallery: boolean; posts: boolean } }>().notNull(),
    generationError: text("generation_error"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("websites_slug_uq").on(t.slug), index("websites_business_idx").on(t.businessId)],
);

export const websitePages = pgTable(
  "website_pages",
  {
    id: id(),
    websiteId: uuid("website_id").notNull().references(() => websites.id, { onDelete: "cascade" }),
    path: text("path").notNull(),
    type: text("type", { enum: ["home", "services", "service", "service_area", "about", "reviews", "contact", "faqs", "privacy", "terms", "custom"] }).notNull(),
    title: text("title").notNull(),
    navLabel: text("nav_label").notNull(),
    metaTitle: text("meta_title"),
    metaDescription: text("meta_description"),
    canonicalUrl: text("canonical_url"),
    noindex: boolean("noindex").notNull().default(false),
    sections: jsonb("sections").$type<SiteSection[]>().notNull(),
    position: integer("position").notNull().default(0),
    updatedAt: updatedAt(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("website_pages_path_uq").on(t.websiteId, t.path)],
);

export const websiteRevisions = pgTable(
  "website_revisions",
  {
    id: id(),
    websiteId: uuid("website_id").notNull().references(() => websites.id, { onDelete: "cascade" }),
    number: integer("number").notNull(),
    snapshot: jsonb("snapshot").$type<{ pages: unknown[]; theme: unknown; settings: unknown }>().notNull(),
    note: text("note"),
    createdByUserId: uuid("created_by_user_id"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("website_revisions_number_uq").on(t.websiteId, t.number)],
);

export const websiteDeployments = pgTable("website_deployments", {
  id: id(),
  websiteId: uuid("website_id").notNull().references(() => websites.id, { onDelete: "cascade" }),
  revisionId: uuid("revision_id").notNull().references(() => websiteRevisions.id, { onDelete: "cascade" }),
  status: text("status", { enum: ["validating", "failed_validation", "deployed", "failed", "rolled_back"] }).notNull(),
  checks: jsonb("checks").$type<{ page: string; issues: ValidationIssue[] }[]>(),
  url: text("url"),
  error: text("error"),
  createdByUserId: uuid("created_by_user_id"),
  createdAt: createdAt(),
});

export const faqs = pgTable(
  "faqs",
  {
    id: id(),
    businessId: uuid("business_id").notNull().references(() => businessLocations.id, { onDelete: "cascade" }),
    question: text("question").notNull(),
    answer: text("answer").notNull(),
    status: text("status", { enum: ["draft", "pending_approval", "approved", "published", "rejected"] }).notNull().default("draft"),
    sourceFactIds: uuid("source_fact_ids").array(),
    validation: jsonb("validation").$type<ValidationResult>(),
    questionHash: text("question_hash").notNull(),
    taskId: uuid("task_id"),
    publishedAt: ts("published_at"),
    staleSince: ts("stale_since"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("faqs_business_qhash_uq").on(t.businessId, t.questionHash)],
);

export const seoAudits = pgTable("seo_audits", {
  id: id(),
  businessId: uuid("business_id").notNull().references(() => businessLocations.id, { onDelete: "cascade" }),
  url: text("url").notNull(),
  status: text("status", { enum: ["queued", "running", "completed", "failed"] }).notNull().default("queued"),
  extracted: jsonb("extracted").$type<Record<string, unknown>>(),
  httpStatus: integer("http_status"),
  error: text("error"),
  startedAt: ts("started_at"),
  completedAt: ts("completed_at"),
  createdAt: createdAt(),
});

export const seoRecommendations = pgTable(
  "seo_recommendations",
  {
    id: id(),
    auditId: uuid("audit_id").notNull().references(() => seoAudits.id, { onDelete: "cascade" }),
    businessId: uuid("business_id").notNull().references(() => businessLocations.id, { onDelete: "cascade" }),
    element: text("element").notNull(),
    currentValue: text("current_value"),
    recommendedValue: text("recommended_value"),
    status: text("status", { enum: ["needs_work", "optimized", "pending", "unverifiable", "applied", "dismissed"] }).notNull(),
    basis: text("basis", { enum: ["detected", "recommendation", "assumption"] }).notNull(),
    explanation: text("explanation").notNull(),
    confidence: doublePrecision("confidence").notNull(),
    instructions: text("instructions"),
    appliedAt: ts("applied_at"),
    recheckedAt: ts("rechecked_at"),
    createdAt: createdAt(),
  },
  (t) => [index("seo_recs_business_idx").on(t.businessId)],
);

export const schemaDocuments = pgTable("schema_documents", {
  id: id(),
  businessId: uuid("business_id").notNull().references(() => businessLocations.id, { onDelete: "cascade" }),
  jsonLd: jsonb("json_ld").$type<Record<string, unknown>>().notNull(),
  validation: jsonb("validation").$type<ValidationResult>().notNull(),
  isCurrent: boolean("is_current").notNull().default(true),
  createdAt: createdAt(),
});

export const aiVisibilityAudits = pgTable("ai_visibility_audits", {
  id: id(),
  businessId: uuid("business_id").notNull().references(() => businessLocations.id, { onDelete: "cascade" }),
  status: text("status", { enum: ["queued", "running", "completed", "partial", "failed"] }).notNull().default("queued"),
  providers: text("providers").array().notNull(),
  templateVersion: text("template_version").notNull(),
  trigger: text("trigger", { enum: ["manual", "schedule"] }).notNull().default("manual"),
  stats: jsonb("stats").$type<Record<string, number>>(),
  createdAt: createdAt(),
  completedAt: ts("completed_at"),
});

export const aiVisibilityQueries = pgTable(
  "ai_visibility_queries",
  {
    id: id(),
    auditId: uuid("audit_id").notNull().references(() => aiVisibilityAudits.id, { onDelete: "cascade" }),
    businessId: uuid("business_id").notNull().references(() => businessLocations.id, { onDelete: "cascade" }),
    keywordId: uuid("keyword_id").references(() => keywords.id, { onDelete: "set null" }),
    keyword: text("keyword").notNull(),
    city: text("city"),
    queryText: text("query_text").notNull(),
    provider: text("provider").notNull(),
    model: text("model"),
    status: text("status", { enum: ["queued", "succeeded", "failed", "unsupported"] }).notNull().default("queued"),
    responseText: text("response_text"),
    sources: jsonb("sources").$type<{ url: string; title?: string }[]>(),
    mentionedBusinesses: jsonb("mentioned_businesses").$type<{ name: string; position: number; isTarget: boolean; matchReason?: string }[]>(),
    mentioned: boolean("mentioned"),
    position: integer("position"),
    error: text("error"),
    isDemo: boolean("is_demo").notNull().default(false),
    ranAt: ts("ran_at"),
  },
  (t) => [index("ai_vis_queries_audit_idx").on(t.auditId)],
);

/* ------------------------------------------------------------------ */
/* Reporting, notifications, audit log, usage                          */
/* ------------------------------------------------------------------ */

export const performanceMetrics = pgTable(
  "performance_metrics",
  {
    id: id(),
    businessId: uuid("business_id").notNull().references(() => businessLocations.id, { onDelete: "cascade" }),
    metric: text("metric").notNull(),
    date: date("date").notNull(),
    value: integer("value").notNull(),
    source: text("source").notNull(),
    isDemo: boolean("is_demo").notNull().default(false),
    fetchedAt: ts("fetched_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("perf_metrics_uq").on(t.businessId, t.metric, t.date, t.source)],
);

export const reports = pgTable(
  "reports",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    businessId: uuid("business_id").notNull().references(() => businessLocations.id, { onDelete: "cascade" }),
    type: text("type", { enum: ["monthly", "on_demand"] }).notNull(),
    periodStart: date("period_start").notNull(),
    periodEnd: date("period_end").notNull(),
    status: text("status", { enum: ["queued", "generating", "ready", "failed"] }).notNull().default("queued"),
    data: jsonb("data").$type<Record<string, unknown>>(),
    narrative: text("narrative"),
    html: text("html"),
    error: text("error"),
    creditsCharged: integer("credits_charged").notNull().default(0),
    requestedByUserId: uuid("requested_by_user_id"),
    generatedAt: ts("generated_at"),
    createdAt: createdAt(),
  },
  (t) => [index("reports_business_idx").on(t.businessId, t.createdAt)],
);

export const reportDeliveries = pgTable("report_deliveries", {
  id: id(),
  reportId: uuid("report_id").notNull().references(() => reports.id, { onDelete: "cascade" }),
  recipient: text("recipient").notNull(),
  status: text("status", { enum: ["queued", "sent", "failed", "logged_only"] }).notNull(),
  emailMessageId: uuid("email_message_id"),
  error: text("error"),
  createdAt: createdAt(),
});

export const creditLedger = pgTable(
  "credit_ledger",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    delta: integer("delta").notNull(),
    reason: text("reason", { enum: ["grant", "report_charge", "report_refund", "adjustment"] }).notNull(),
    reportId: uuid("report_id"),
    note: text("note"),
    createdAt: createdAt(),
  },
  (t) => [index("credit_ledger_org_idx").on(t.orgId)],
);

export const emailMessages = pgTable(
  "email_messages",
  {
    id: id(),
    orgId: uuid("org_id"),
    to: text("to").notNull(),
    fromName: text("from_name"),
    fromEmail: text("from_email"),
    subject: text("subject").notNull(),
    html: text("html").notNull(),
    text: text("text").notNull(),
    template: text("template").notNull(),
    status: text("status", { enum: ["queued", "sent", "failed", "suppressed", "logged_only"] }).notNull().default("queued"),
    provider: text("provider"),
    providerMessageId: text("provider_message_id"),
    error: text("error"),
    relatedType: text("related_type"),
    relatedId: text("related_id"),
    attempts: integer("attempts").notNull().default(0),
    createdAt: createdAt(),
    sentAt: ts("sent_at"),
  },
  (t) => [index("email_messages_org_idx").on(t.orgId, t.createdAt)],
);

export const notifications = pgTable(
  "notifications",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    businessId: uuid("business_id"),
    type: text("type").notNull(),
    title: text("title").notNull(),
    body: text("body"),
    link: text("link"),
    readAt: ts("read_at"),
    createdAt: createdAt(),
  },
  (t) => [index("notifications_user_idx").on(t.userId, t.readAt)],
);

export type NotificationPrefs = {
  channels: Record<string, { email: boolean; inApp: boolean }>;
  quietHours?: { start: string; end: string; timezone: string };
  digest: "immediate" | "daily";
};

export const notificationPreferences = pgTable(
  "notification_preferences",
  {
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    prefs: jsonb("prefs").$type<NotificationPrefs>().notNull(),
    updatedAt: updatedAt(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.orgId] })],
);

export const activityEvents = pgTable(
  "activity_events",
  {
    id: id(),
    orgId: uuid("org_id").notNull(),
    businessId: uuid("business_id"),
    actorType: text("actor_type", { enum: ["user", "system", "approval_link", "public"] }).notNull(),
    actorId: text("actor_id"),
    action: text("action").notNull(),
    targetType: text("target_type"),
    targetId: text("target_id"),
    detail: jsonb("detail").$type<Record<string, unknown>>(),
    ip: text("ip"),
    createdAt: createdAt(),
  },
  (t) => [index("activity_org_idx").on(t.orgId, t.createdAt), index("activity_business_idx").on(t.businessId, t.createdAt)],
);

export const usageRecords = pgTable(
  "usage_records",
  {
    id: id(),
    orgId: uuid("org_id").notNull(),
    businessId: uuid("business_id"),
    metric: text("metric", { enum: ["ai_request", "ai_tokens", "ranking_point", "ai_visibility_query", "video_render", "email", "report", "publication"] }).notNull(),
    quantity: integer("quantity").notNull(),
    provider: text("provider"),
    detail: jsonb("detail").$type<Record<string, unknown>>(),
    createdAt: createdAt(),
  },
  (t) => [index("usage_org_metric_idx").on(t.orgId, t.metric, t.createdAt)],
);

export const rateLimits = pgTable("rate_limits", {
  key: text("key").primaryKey(),
  count: integer("count").notNull(),
  windowStart: ts("window_start").notNull(),
});
