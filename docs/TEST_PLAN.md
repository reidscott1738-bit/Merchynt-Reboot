# Test plan

## Levels

| Level | Tool | Location | Runs against |
|---|---|---|---|
| Unit | Vitest | `tests/unit` | Pure functions in `src/lib` and builders. No database. |
| Integration | Vitest | `tests/integration` | Real services and a real PostgreSQL test database (`localpilot_test`), demo mode on, provider keys removed, file storage in `./storage-test`. `resetDb()` refuses any database whose URL does not contain `localpilot_test`. |
| End to end | Playwright | `tests/e2e` | A production build (`next start` on port 3100) with the test database, `DEMO_MODE=true` and a throwaway `ENCRYPTION_KEY` generated per run. |
| Live provider checks | Manual, per [INTEGRATIONS.md](INTEGRATIONS.md) | — | Real accounts. Not yet possible: no credentials. |

Commands: `npm run test:unit`, `npm run test:integration`, `npm test` (both), `npm run build && npm run test:e2e`.

Tests are never skipped or disabled to get a green run. A test that fails because of a real bug is fixed in the code (for example, the GPS longitude sign bug found by the media test).

## What is covered

### Unit (43 tests)

- **Content validation**: plain facts pass; unverified claims, wrong phone numbers, placeholders, over-length text and near-duplicates are caught; risky review replies are flagged; training instructions asking for unverified claims are warned.
- **Policies**: per-star review modes; 1 to 2-star ratings never auto-publish even if misconfigured; already-answered or in-flight reviews are skipped; templates; post approval modes; failed validation forces approval; only defined task transitions; client approvers can only view and approve; org management stays with owners.
- **Rankings**: failed points excluded from every statistic; null shares when nothing succeeded; point-by-point comparison treats failures as not comparable; rank bands; competitor aggregation excludes the business; deterministic odd grids; invalid sizes rejected.
- **Report math**: changes without invented values; estimated value only with an explicit assumption; periods.
- **AI visibility**: versioned question variations; ordered extraction of listed businesses; identity matching by distinctive tokens or domain.
- **CSV contacts**: invalid, duplicate and suppressed rows flagged; email column required.
- **Schedules and holidays**: validation; next run in the business time zone across DST; intervals; floating holidays.
- **SEO**: on-page extraction; local title recommendations with basis labels; LocalBusiness JSON-LD from facts only; hidden-address businesses omit the street; script-tag escaping.
- **Text and redirects**: normalization and escaping; only same-origin redirect paths accepted.

### Integration (31 tests)

- **Tenant isolation**: another org's business is "not found"; client approvers limited to their clients and to approval permissions; approvers with no clients see nothing; stored tokens never returned by the integrations list.
- **Approval links**: viewing changes nothing; one use only and sibling links revoked; concurrent clicks run the workflow once; disallowed actions refused while the link stays usable; failed preconditions leave the task open; expired links cannot act; dashboard approval limited to the same org.
- **Demo honesty**: demo publications have no provider id or link; with demo mode off and Google not connected, publishing is blocked rather than faked; demo reviews and demo-published posts stay off public sites; demo reviews do not count toward structured-data ratings.
- **Media**: camera GPS read when present (with hemisphere), all metadata stripped from public variants; no invented location; duplicate uploads de-duplicated; non-media files rejected.
- **Review requests**: opting out suppresses the address org-wide; every visitor sees the same review page.
- **Report credits**: refused without credits; charged exactly once under concurrency; only owners grant credits.
- **Infrastructure**: rate limits per key and window; idempotent enqueue; a job is never handed to two workers.
- **Review automation**: auto for 5 stars, escalated approval for 1 star; no second draft for a review already being handled; reviews with an owner reply skipped.
- **Website builder**: multi-page draft is not public until published; manual edits kept on regeneration; publishing is a snapshot unaffected by later edits; unverified claims block publishing.

### End to end (8 tests)

1. Signed-out visitors are redirected to sign in.
2. Sign up, create a business, see the demo banner.
3. Every business screen renders without a server error.
4. Build and publish a website; it is public only after publishing; sitemap and robots respond.
5. Another organization cannot open the business.
6. The public review page sends everyone to the same Google button; unsubscribing needs a button click.
7. Approval links that do not exist change nothing.
8. Health endpoint works; media endpoint rejects unsigned and badly signed requests.

## Gaps to close next

- Live provider verification for each integration once credentials exist (record evidence in FEATURE_MATRIX).
- Dedicated tests for: profile optimization score and Google push, video render pipeline (ffmpeg), report HTML generation and email delivery, automation `schedulerTick` end to end, custom-domain routing in `src/proxy.ts`, OAuth callback state handling, agency offboarding.
- Browser tests for approving from an email link, Photo Boost uploads, and the video editor.
- Accessibility checks (axe) on the main screens.
