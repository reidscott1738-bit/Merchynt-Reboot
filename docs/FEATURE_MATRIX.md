# Feature matrix

Rows follow the blueprint's functional parity checklist (section 28), plus the modules the build prompt added.

**Status values:** Not started, In progress, Implemented, Tested, Verified against live integration, Blocked by an external requirement.

- **Implemented** means the screen, service and job exist and the screen renders in the browser test. No dedicated automated test covers the feature's logic yet.
- **Tested** means automated tests cover the logic (see [TEST_PLAN.md](TEST_PLAN.md)).
- **Live** says what is still needed before the feature can be verified against the real provider. No row is "Verified against live integration" yet, because no provider credentials have been supplied.

Status as of 2026-10-18.

## Business onboarding

| Capability | Status | Live | Where |
|---|---|---|---|
| Google sign-in and account authorization | Implemented | Blocked: needs `GOOGLE_CLIENT_ID`/`SECRET` and an approved Business Profile API project | `integrations/oauth.ts`, `api/oauth/*` |
| Multiple Google accounts and business locations | Implemented | Blocked: same as above | `services/integrations.ts`, business Integrations screen |
| Website and profile data extraction (facts proposed, then confirmed) | Implemented | Website extraction works without credentials; profile import blocked on Google | `services/seo.ts`, `services/business.ts` |
| Business information and description editing | Implemented | Push to Google blocked on Google | Profile screen |
| Keyword selection and geographic audit setup | Tested | Volumes blocked: needs DataForSEO | Keywords, Rankings |
| Service and attribute recommendations | Implemented | Attribute list blocked on Google | `services/optimization.ts` |
| Trust recommended defaults | Implemented | n/a | Onboarding |
| Organizations, roles, client approvers | Tested | n/a | `lib/permissions.ts`, `tests/integration/tenancy` |

## SEO and audits

| Capability | Status | Live | Where |
|---|---|---|---|
| Geographic ranking heatmaps | Tested | Blocked: needs DataForSEO (demo adapter labeled) | `services/rankings.ts`, `lib/ranking-metrics.ts`, `lib/geo.ts` |
| Historical ranking comparisons | Tested | Blocked: DataForSEO | Rankings audit view |
| Competitor tracking | Tested | Blocked: DataForSEO | Competitors |
| Profile optimization score and recommendations | Implemented | Live data blocked on Google | `lib/optimization-score.ts`, `services/optimization.ts` |
| AI-search visibility audits | Tested (parsing, matching) | Blocked: needs OpenAI, Gemini or Perplexity keys | `lib/ai-visibility.ts`, `services/ai-visibility.ts` |
| Website SEO recommendations | Tested | Works without credentials | `lib/seo-analyzer.ts`, SEO screen |
| Schema generation and validation | Tested | n/a | `lib/schema-org.ts`, SEO screen |

## Reviews

| Capability | Status | Live | Where |
|---|---|---|---|
| Review ingestion | Implemented | Blocked on Google | `services/reviews.ts` `syncReviews` |
| Rating-specific response policies | Tested | n/a | `lib/review-policy.ts`, `tests/integration/reviews` |
| AI replies, templates and ignore rules | Tested | AI writing needs `ANTHROPIC_API_KEY` or `GEMINI_API_KEY` | Reviews |
| Human approval and task assignment | Tested | n/a | `tests/integration/approvals` |
| Historical review processing | Implemented | Blocked on Google | `processReviews(..., "historical")` |
| Review removal requests | Implemented | User files in Google | Reviews |
| Review request campaigns and follow-ups | Tested (suppression, CSV) | Sending needs `SMTP_URL` | Review requests |
| CSV import, links and attribution | Tested | n/a | `lib/csv-contacts.ts`, `/r/[slug]` |
| Same review page for every customer (no gating) | Tested | n/a | e2e and integration tests |
| Customer photo collection (Photo Boost) and approval | Implemented | n/a | `/r/[slug]`, Media moderation |

## Content and media

| Capability | Status | Live | Where |
|---|---|---|---|
| Scheduled Google posts | Tested (approval policy, demo honesty) | Blocked on Google | `services/posts.ts`, `services/publishing.ts` |
| Social publishing adapters (Facebook, Instagram, LinkedIn, YouTube) | Implemented | Blocked: needs Meta, LinkedIn and Google apps with publishing approval | `integrations/social/*` |
| Image library and usage permissions | Tested (EXIF, de-dup, type checks) | n/a | `services/media.ts` |
| CompanyCam import | Implemented | Blocked: needs CompanyCam OAuth app | `integrations/companycam.ts` |
| Logo branding and CTA overlays | Implemented | n/a | `services/media.ts`, `services/posts.ts` |
| AI image-generation controls | Blocked by an external requirement | No image-generation provider chosen; the option is shown as unavailable and posts go without an image | `services/posts.ts` |
| Automated video creation and editing | Implemented | Rendering works locally with ffmpeg; publishing blocked on YouTube/Meta/Google | `services/videos.ts` |
| Voice, music, scene and text controls | Implemented | Voice needs `ELEVENLABS_API_KEY`; music is synthesized locally | Video studio |

## Website

| Capability | Status | Live | Where |
|---|---|---|---|
| Multi-page site generation | Tested | AI writing needs `ANTHROPIC_API_KEY` or `GEMINI_API_KEY` | `services/websites.ts` |
| Page and section editing, manual edits kept on regenerate | Tested | n/a | `tests/integration/website` |
| Title tags and meta descriptions | Implemented | n/a | Website builder |
| FAQs and structured data | Tested (schema) | n/a | SEO screen, site renderer |
| Review, gallery and post widgets (real data only) | Tested | n/a | `components/site/render.tsx`, `tests/integration/honesty` |
| Domain connection and deployment | Implemented | DNS verification works; TLS must be provided by a reverse proxy | `src/proxy.ts`, Website builder |
| Responsive layout and revision history | Tested (snapshot publishing) | n/a | Website builder |

## Operations and agencies

| Capability | Status | Live | Where |
|---|---|---|---|
| Persistent automation settings | Tested (schedules, DST) | n/a | Automations |
| Background scheduling and retries | Tested (idempotency, SKIP LOCKED) | n/a | `jobs/queue.ts`, `worker` |
| Approval dashboard and single-use email links | Tested | Email sending needs `SMTP_URL` | Tasks, `/approve/[token]` |
| Performance and monthly reports | Tested (math, credits) | Google metrics blocked on Google | Reports |
| Notification and account-health monitoring | Implemented | n/a | Notifications, Agency |
| White-label branding and custom domains | Implemented | Sender verification needs `SMTP_URL`; app domains need `APP_HOSTS` | Settings |
| Multi-tenant isolation and audit logs | Tested | n/a | `tests/integration/tenancy`, `activity.ts` |
| Billing for report credits | Not started | Credits are granted manually by owners | Settings, Usage |
