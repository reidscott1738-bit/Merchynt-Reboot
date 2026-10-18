# Implementation plan

Living record of what is built, how it was tested, what is blocked and what comes next. Phases follow the blueprint's recommended build order (section 27).

Last updated: 2026-10-18.

## Phase status

| Phase | Scope | State | Acceptance test (blueprint) | Evidence |
|---|---|---|---|---|
| 1. Core infrastructure | Auth, tenants, businesses, Google connections, permissions, integration health, audit log | Done; Google connection awaits credentials | Two customers cannot access each other's data | `tests/integration/tenancy`, e2e test 5 |
| 2. Profile optimization and ranking | Onboarding, fact extraction, keywords, recommendations, Google updates, grid audits | Done; live Google and DataForSEO await credentials | Onboard, approve changes, view a verified ranking audit | Ranking unit tests; e2e test 3; live audit blocked |
| 3. Reviews and tasks | Ingestion, per-star rules, Train AI, approval routing, email links, review requests, Photo Boost | Done | Every action follows the approval policy and is traceable | `tests/integration/approvals`, `reviews`, `media-campaigns-reports` |
| 4. Content engine | Scheduled posts, image selection, branding, queues, social connections, retries, monitoring | Done; live publishing awaits credentials | A scheduled post is generated, approved when required, published once and recorded | Approval and honesty tests; idempotent queue test; live publish blocked |
| 5. Media production | Library, metadata, moderation, video scripting, voice, editing, publishing | Done; narration and publishing await credentials | Edit, preview, approve and verify a video publication | Media integration tests; video render untested (gap) |
| 6. Website and AI SEO | Multi-page generation, section editor, domains, schema, FAQs, widgets, AI visibility | Done; AI visibility awaits provider keys | Publish a site, update a section, run an AI visibility test | `tests/integration/website`, SEO unit tests, e2e test 4 |
| 7. Reporting and agency | Reports, scheduled delivery, white label, custom domains, client management, health | Done; Google metrics await credentials | Agency manages clients, delivers branded reports, data isolated | Credit and report-math tests; tenancy tests |

## Completed work

- **Platform.** Next.js 16 app with server actions; 71-table PostgreSQL schema with migrations; role matrix; tenant-scoped services; activity log; Postgres job queue with idempotency, `SKIP LOCKED`, backoff, timeouts and stale-job reclaim; worker and cron endpoint; rate limits; signed media links; encrypted tokens; SSRF-safe fetching.
- **Screens.** Dashboard, business overview, onboarding with recommended defaults, profile, Train AI, keywords, rankings with heatmap and comparisons, competitors, reviews, review requests, media, posts with calendar, videos and editor, website builder with preview, Website & AI SEO, AI visibility, reports, automations, integrations, tasks, notifications, account, org settings (members, branding, domains, connections, usage, activity), agency.
- **Public surfaces.** Approval pages (read-only until a button is pressed), review pages with Photo Boost, unsubscribe confirmation, connection invites, team invites, customer upload links, published websites with sitemap and robots, custom-domain routing.
- **Honesty.** Demo adapters only in demo mode and always labeled; blocked features name the missing setting; no rating-based review gating; estimates require an assumption; metadata stripped from public images.
- **Seed.** `npm run db:seed` builds a demo agency, client and plumbing business with verified facts, keywords and labeled demo reviews.
- **Docs.** All seven documents in `docs/`, README and `.env.example`.

## Latest test results (2026-10-18)

| Check | Result |
|---|---|
| `npm run typecheck` | Pass |
| `npm run lint` | Pass |
| `npm test` (Vitest) | 77 of 77 pass, 12 files (46 unit, 31 integration) |
| `npm run build` | Pass |
| `npm run test:e2e` (Playwright, production build) | 8 of 8 pass |

Bugs found and fixed by the tests:

- West longitudes were stored as positive because the EXIF hemisphere fields were not read.
- The sitemap route was being prerendered at build time.
- The e2e media test hit a 500 because production mode requires `ENCRYPTION_KEY`; the e2e config now generates a throwaway key per run.

## Blockers (external)

| Blocker | Unblocks | Who |
|---|---|---|
| Google Cloud project with Business Profile API access approved, OAuth client | Profile import and updates, reviews, posts, photos, metrics, YouTube | Reid |
| Meta app with App Review for page and Instagram permissions | Facebook and Instagram publishing | Reid |
| LinkedIn app with Community Management API | LinkedIn publishing | Reid |
| DataForSEO account | Live grid audits and keyword volumes | Reid |
| Anthropic API key, or a free Gemini API key | Real AI writing (otherwise demo text, labeled) | Reid |
| OpenAI, Gemini and/or Perplexity keys | Live AI visibility audits | Reid |
| ElevenLabs key | Video narration | Reid |
| SMTP relay | Sending approval emails, invites, review requests and reports | Reid |
| Hosting with a TLS reverse proxy | Custom domains on HTTPS | Reid |
| Decision on pushing to the GitHub repository | Code leaves this environment | Reid |

## Known gaps

- Report and campaign emails do not yet send a `List-Unsubscribe` header (the unsubscribe link is in the body).
- Invite and upload URLs are shown once via a query string after creation.
- White-label app domains must be listed in `APP_HOSTS`; TLS for customer domains depends on the reverse proxy.
- Report credits are granted manually; there is no billing integration.
- No AI image-generation provider.

## Next tasks

1. Connect real credentials one provider at a time and verify each feature against a live account; record evidence and move rows to "Verified against live integration" in [FEATURE_MATRIX.md](FEATURE_MATRIX.md).
2. Add the test gaps listed in [TEST_PLAN.md](TEST_PLAN.md): video render, scheduler end to end, report generation and delivery, proxy routing, OAuth callback.
3. Add `List-Unsubscribe` and `List-Unsubscribe-Post` headers to campaign and report email.
4. Move media storage to S3-compatible object storage for multi-instance hosting.
5. Billing for report credits.
6. Accessibility audit with axe on the main screens.
