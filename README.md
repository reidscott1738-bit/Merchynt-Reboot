# LocalPilot

LocalPilot is an AI-assisted local SEO and marketing platform for local businesses and the agencies that manage them. It covers the functional surface described in `Paige_Complete_Product_Replication_Blueprint.pdf`: Google Business Profile optimization, grid ranking audits, review automation, review requests, scheduled posts, a media library, AI videos, a website builder, Website & AI SEO, AI visibility audits, approvals, automations, reports and white-label agency tools.

It is an independent implementation. It does not reuse or guess at Paige's private prompts, algorithms, schema or APIs.

## Honesty rules the code enforces

- Nothing fabricated is shown as real. Without a provider's credentials a feature is either **blocked** with a message naming the missing setting, or, only when `DEMO_MODE=true`, runs a **demo adapter**. Demo rows are stored with `is_demo = true`, shown with a Demo badge, have no provider id or link, and never appear on public websites or in structured data.
- Estimates (like report "estimated value") are only computed from an assumption the user entered, and are labeled as estimates with the assumption shown.
- Images are always served from re-encoded variants with no EXIF. GPS is read only from real camera metadata; nothing is ever written into a photo.
- AI content is checked against verified business facts before it can publish. Unverified claims, wrong phone numbers, placeholders and near-duplicates force human approval or block publishing.

## Quick start

Requirements: Node 22+, PostgreSQL 15+, and `ffmpeg` on the PATH for video rendering.

```bash
npm install
cp .env.example .env            # then set ENCRYPTION_KEY and anything else you need
createdb localpilot             # or use your own DATABASE_URL
npm run db:migrate
npm run db:seed                 # optional: demo agency, client and business; prints a password
npm run dev                     # web app on http://localhost:3000
npm run worker                  # background jobs and automation scheduler (separate process)
```

Set `DEMO_MODE=true` to explore features whose providers you have not configured; every demo result is labeled.

Instead of running the worker continuously you can call `POST /api/cron` with `Authorization: Bearer $CRON_SECRET` on a schedule, but jobs then only run on each tick.

## Configuration

Every variable is documented in [`.env.example`](.env.example). Provider credentials are optional individually; the Integrations screens say exactly which variable each feature needs. All secrets are read only on the server, OAuth tokens are encrypted at rest with `ENCRYPTION_KEY`, and the browser never receives them.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` / `build` / `start` | Next.js app |
| `npm run worker` | Job worker and scheduler (`WORKER_CONCURRENCY`, `WORKER_QUEUES`) |
| `npm run db:generate` | Generate a migration after changing `src/server/db/schema.ts` |
| `npm run db:migrate` | Apply migrations |
| `npm run db:seed` | Seed demo data (refuses production unless `SEED_ALLOW_PRODUCTION=true`) |
| `npm run typecheck` / `lint` | TypeScript strict check and ESLint |
| `npm test` | Unit and integration tests (Vitest, needs the test database) |
| `npm run test:e2e` | Browser tests (Playwright) against a production build |

### Test database

Integration and browser tests truncate their database, and refuse to run unless the URL contains `localpilot_test`:

```bash
createdb localpilot_test
TEST_DATABASE_URL=postgres://localpilot:localpilot@localhost:5432/localpilot_test DATABASE_URL=$TEST_DATABASE_URL npm run db:migrate
npm test
npm run build && npm run test:e2e   # PLAYWRIGHT_CHROMIUM_PATH=/path/to/chromium if needed
```

## Documentation

- [Product requirements](docs/PRODUCT_REQUIREMENTS.md)
- [Feature matrix](docs/FEATURE_MATRIX.md) with the status of every capability
- [Architecture](docs/ARCHITECTURE.md)
- [Database schema](docs/DATABASE_SCHEMA.md)
- [Integrations](docs/INTEGRATIONS.md)
- [Implementation plan](docs/IMPLEMENTATION_PLAN.md) with completed work, test results, blockers and next tasks
- [Test plan](docs/TEST_PLAN.md)
