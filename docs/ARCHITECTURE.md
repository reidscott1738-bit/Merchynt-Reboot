# Architecture

## Overview

```
Browser ──► Next.js 16 app (App Router, React 19 server components, server actions)
              │   src/proxy.ts: custom-domain routing, strips client-supplied x-lp-site-host
              │   src/app/(app)       signed-in product screens
              │   src/app/(public)    approval links, review pages, invites, uploads (noindex)
              │   src/app/sites       published customer websites
              │   src/app/api         OAuth, signed media, cron, health
              ▼
         src/server/services   business logic, authorization on every call
              │
              ├── src/server/db         Drizzle ORM over PostgreSQL (71 tables)
              ├── src/server/jobs       Postgres job queue
              ├── src/server/ai         AI provider (Anthropic) and prompt tasks
              ├── src/server/integrations  Google, Meta, LinkedIn, YouTube, CompanyCam,
              │                            DataForSEO, AI search engines, ElevenLabs
              ├── src/server/storage    local file storage, HMAC-signed media URLs
              └── src/server/email      SMTP via nodemailer, stored outbox

Worker process (src/worker) ──► claims jobs, runs handlers, runs the automation scheduler
```

The web app and the worker share the same code and database. Nothing that talks to a provider runs in the browser; every credential lives in server environment variables or in encrypted columns.

## Layers

| Layer | Responsibility |
|---|---|
| `src/app` | Routing and rendering only. Pages load data through services with the current actor. Mutations are server actions that call `formAction()`, which validates input, calls one service, and redirects with `?ok=` or `?err=`. Only `AppError` messages reach users. |
| `src/lib` | Pure, framework-free logic: permissions, content validation, review and approval policies, schedules, ranking metrics, report math, SEO analysis, schema.org builder, CSV parsing. Unit-tested. |
| `src/server/services` | Use cases. Each public function takes an `Actor`, calls `requireBusiness`/`assertCan`, does the work in a transaction where needed, writes activity events and enqueues jobs. |
| `src/server/integrations` | Thin provider clients. They return typed results or throw `ProviderAuthError`/`TransientError`. Demo adapters live beside real ones and are only chosen when `DEMO_MODE=true` and the provider is not configured. |
| `src/server/jobs` | Queue (`enqueue`, `claimJobs`, `completeJob`, `failJob`, `reclaimStaleJobs`) and the handler registry. Handlers are registered by importing `src/server/services/register.ts`. |

## Tenancy and authorization

- `organizations` → `clients` → `business_locations`. Memberships carry a role (`owner`, `admin`, `member`, `client_approver`) and, for client approvers, the client ids they may see.
- `requireBusiness(actor, id)` loads a business only within the actor's active organization and client scope, and raises `not_found` otherwise, so other tenants' ids are indistinguishable from missing ones.
- Permissions are a static matrix in `src/lib/permissions.ts`. The UI uses it to hide controls; services enforce it.
- Sessions: random token in an `httpOnly`, `SameSite=Lax` cookie (Secure on https), stored as a SHA-256 hash. Passwords use scrypt. Changing a password signs out other sessions.

## Content pipeline

1. **Context**: `src/server/ai/context.ts` builds a business context from verified knowledge, services, areas and Train AI instructions for the content area.
2. **Generation**: `src/server/ai/tasks.ts` defines one function per content type (post, review reply, description, website section, FAQ, video script, alt text, fact extraction). Each prompt is written for LocalPilot and asks the model to use only supplied facts.
3. **Validation**: `src/lib/content-validation.ts` checks length, placeholders, phone numbers against the business, claims against verified facts, risky review-reply language and near-duplicates of recent content.
4. **Policy**: `src/lib/approval-policy.ts` and `src/lib/review-policy.ts` decide whether the item needs approval. A failed validation always forces approval; escalated star ratings never auto-publish.
5. **Task or publish**: either a task with single-use approval links is created, or a `publication_jobs` row and a `publish.run` job are queued.
6. **Publish**: the handler calls the provider adapter, stores the provider id and URL, or marks the publication `is_demo` with no id or URL. Failures retry with backoff; permanent failures notify the business's users.

## Jobs and scheduling

- Jobs are rows in `jobs` with a queue, type, payload, idempotency key, attempts, `run_at` and lease. Workers claim with `FOR UPDATE SKIP LOCKED`, so no job runs twice concurrently. Retries back off exponentially (base 30 s, 5 attempts by default). Leases that expire are reclaimed.
- Job types: `automation.run`, `email.send`, `media.describe`, `publish.run`, `ranking.audit`, `report.generate`, `seo.audit`, `video.render`.
- The scheduler (`schedulerTick`) reads due `automation_rules`, computes the next run in the business time zone (DST-safe) and enqueues one `automation.run` per due rule with an idempotency key for that slot.
- Either run `npm run worker`, or call `POST /api/cron` with the `CRON_SECRET` bearer token.

## Approvals

- `tasks` move through a defined state machine (`src/lib/approval-policy.ts`). Approving runs the registered handler for the task type exactly once: the task and token are claimed with conditional updates, so concurrent clicks cannot both act (tested).
- `approval_tokens` are random, stored as SHA-256 hashes, scoped to allowed actions, expire, and are single-use; using one revokes the task's other tokens. `GET /approve/[token]` is read-only; only the POST button acts. If the action fails a precondition, the task stays open and the link stays usable.

## Media

- Uploads are type-sniffed, size-limited, hashed for de-duplication and stored under `STORAGE_DIR`.
- EXIF is read (capture time, GPS with hemisphere refs). Public variants are re-encoded with sharp and carry no metadata. Originals are never served for images.
- `publicMediaUrl()` creates HMAC-signed links (key derived from `ENCRYPTION_KEY`, required in production). `/api/public/media/[id]` checks the signature with `timingSafeEqual`, supports Range, and sends `Content-Security-Policy: sandbox` and `nosniff`.
- Videos are rendered with ffmpeg from scenes; narration from ElevenLabs when configured; background music synthesized locally.

## Websites

- A website has draft pages with sections. Each section field remembers whether a person edited it; regeneration keeps those fields unless the user picks overwrite.
- Publishing writes an immutable `website_deployments` snapshot; public sites render only the latest deployment, plus live widgets (real reviews, approved public media, posts with a real publication).
- Custom domains: `src/proxy.ts` rewrites any host that is not the app host (or listed in `APP_HOSTS`) to `/sites/_domain/...` and passes the host in `x-lp-site-host`, dropping any copy the client sent. TLS termination and certificate issuance are left to the reverse proxy (for example Caddy on-demand TLS).

## Security controls

| Concern | Control |
|---|---|
| Secrets | Only in env; `.env` ignored by git; tokens AES-256-GCM encrypted at rest; never returned by list APIs (tested) |
| OAuth | State and PKCE verifier stored server-side, single-use; minimum scopes per provider; refresh and revoke on disconnect |
| CSRF | Server actions (origin-checked by Next.js); no state-changing GETs |
| Redirects | `safeRedirectPath` accepts same-origin paths only; external Google review links must be https |
| Abuse | Postgres-backed rate limits on sign-in, sign-up, public forms, approval and upload links |
| User HTML | Reports rendered in `<iframe sandbox>`; media served with CSP sandbox |
| Headers | `X-Frame-Options: SAMEORIGIN`, `Referrer-Policy: strict-origin-when-cross-origin`, `nosniff`; public pages `noindex` |

## Deployment

- One or more web instances (`npm run build && npm start`), one or more workers (`npm run worker`), PostgreSQL, persistent storage for `STORAGE_DIR` (or a shared volume), and a reverse proxy for TLS and customer domains.
- `GET /api/health` checks the database.
- Logs: the worker writes one JSON object per line.
