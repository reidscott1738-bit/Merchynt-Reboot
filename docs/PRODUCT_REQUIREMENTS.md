# LocalPilot product requirements

Source: `Paige_Complete_Product_Replication_Blueprint.pdf` (34 pages, sections 1 to 28) and the master build prompt. Section numbers below refer to the blueprint. Where the blueprint marks something as "Verify" or as not publicly knowable (section 26), LocalPilot uses its own documented design rather than guessing at Paige's.

## 1. Users and tenancy

| Role | Can do |
|---|---|
| Owner | Everything, including org settings, branding, domains, credits |
| Administrator | Everything except org-level settings |
| Team member | Content, reviews, media, websites, reports, audits, Train AI |
| Client approver | View assigned clients' businesses; approve or reject content and media; view reports |

- An organization (agency or single business) owns clients, and clients own business locations. Every query is scoped by organization; a client approver only sees businesses of the clients they are assigned to. Access outside scope returns "not found".
- Authorization is enforced on the server (`src/lib/permissions.ts`, `src/server/authz.ts`); the UI only hides controls.
- Every meaningful change is written to an activity log with actor, business and before/after details.

## 2. Onboarding (blueprint 1, 7, 27 phase 2)

1. Create a business: name, category, address or service-area, phone, website, hours, services.
2. Connect Google (optional) and pick a location; facts are imported from the profile.
3. Extract facts from the website; each proposed fact is shown for confirmation and only becomes "verified" knowledge when a person confirms it.
4. Pick keywords (suggested from category, services and city; volumes only when a data provider is configured).
5. "Trust recommended defaults": one click enables a documented plan of automations and per-star review policies, each listed with whether it publishes automatically. Nothing auto-publishes without that plan or an explicit setting.

## 3. Profile optimization (blueprint 1)

- Score built from documented, explainable checks (description, categories, services, attributes, photos, hours, posts, reviews, replies). Each check shows its weight and why. The weights are LocalPilot's own; Paige's are not public.
- AI recommendations for description, services and attributes, written only from verified facts, each requiring approval before it is pushed to Google. Applied changes are recorded with before/after values.

## 4. Keywords, ranking audits and competitors (blueprint 2)

- Grid audits: odd N×N grid centered on the business, configurable radius, versioned configuration. Each point stores rank, the result list, and success or failure. Failed points are excluded from every statistic and shown as failed, never as "not ranked".
- Heatmap view, average rank, top-3 share, history and point-by-point comparison with the previous run, competitor aggregation from the same results.
- Separate audit types: ranking grid, website SEO audit, AI visibility audit.
- Without a ranking provider, audits are blocked; with `DEMO_MODE` they run a labeled demo adapter.

## 5. Reviews and reputation (blueprint 3)

- Review ingestion from Google (and manual entry), de-duplicated by provider id.
- Per-star policy: ignore, draft for approval, auto-publish, or escalate. 1 and 2-star reviews can never auto-publish, even if misconfigured.
- AI replies use Train AI instructions and verified facts, pass risk checks (no promises of compensation, no private data), and can use templates.
- Approval recipients get a task and a single-use email link.
- Historical unanswered reviews can be processed in a bounded batch.
- Removal requests: record a policy-violation report with its reason and track its status; the user files it in Google.
- Review requests: campaigns via email, CSV import with validation, duplicate and suppression checks, follow-ups, open/click attribution, org-wide unsubscribe. Every recipient sees the same review page with the same Google button: there is no rating-based gating.
- Photo Boost: customers can upload photos from the review page; uploads enter moderation.

## 6. Posts and publishing (blueprint 4)

- Scheduled post generation per business with topics and CTA. Image source: uploaded photos only, uploaded then Google profile photos, or also AI images. No image-generation provider is wired in yet, so the AI option is labeled as such and the post goes out without an image rather than with a fake one.
- Image branding (logo position, CTA text overlay) rendered server-side.
- Approval modes: approve every post, approve only posts with branded or AI images, or publish without approval. Failed content checks always force approval.
- Publishing adapters: Google Business Profile, Facebook Pages, Instagram, LinkedIn, YouTube. Each publication is a job with retries; it records the provider id and link when real, or `is_demo` with no link when demo.
- Calendar and queue views.

## 7. Media (blueprint 5, 25.2, 25.3)

- Upload (browser, signed upload links for customers, CompanyCam import), content-hash de-duplication, type sniffing, size limits.
- EXIF is read for capture time and GPS (with correct hemisphere). Public variants are re-encoded without metadata. LocalPilot never writes or invents geotags.
- Per-image permissions: allowed for posts, website, videos; moderation status for customer uploads; usage tracking.
- AI descriptions and alt text as background jobs.

## 8. Video studio (blueprint 6)

- Script generated from facts and Train AI instructions, split into scenes with images from the library, captions, optional narration (ElevenLabs) and locally synthesized background music (no unlicensed tracks).
- Scene editor (text, image, duration, order), settings (overlays, logo watermark, intro logo, music volume, voices), preview render with ffmpeg, approval, publishing to YouTube, Facebook and Google.

## 9. Train AI (blueprint 7)

- Business knowledge (facts with category, source and verified flag) is separate from writing instructions (per area: posts, reviews, website, videos, images, general).
- Instructions that ask for unverified claims are flagged.
- When facts change, dependent content (for example FAQs) is marked stale.

## 10. Website builder (blueprint 8)

- Multi-page generation (home, services, per-service, about, reviews, gallery, contact, service areas, FAQs) from verified facts.
- Section editor; regenerate a section with an instruction. Manually edited fields are kept on regeneration unless the user explicitly chooses to overwrite.
- Revisions with restore; publishing creates an immutable snapshot, so later draft edits do not change the live site.
- Widgets: reviews (real reviews only), gallery (approved, public media only), posts (only posts with a real publication), map and contact.
- Custom domains with DNS instructions and verification; per-page title, meta description, canonical, robots and sitemap.
- Publishing is blocked when content contains unverified claims.

## 11. Website & AI SEO and AI visibility (blueprint 9)

- Page audit: fetches a URL as a crawler, checks title, meta, headings, local signals, structured data, robots.txt and sitemap. Each recommendation is labeled "Found on the page", "Suggestion" or "Best guess" with a confidence.
- LocalBusiness JSON-LD from verified facts only, validated; hidden-address businesses omit the street address; demo reviews never count toward the rating.
- FAQ generation from verified facts, approved before publishing.
- AI visibility audits: versioned question variations per keyword and city, sent to each configured provider (OpenAI, Gemini, Perplexity). Results record whether the business was mentioned and its position. Providers without keys are shown as unavailable; demo answers are labeled. The page states that AI answers vary between runs.

## 12. Tasks, approvals and automation (blueprint 10, 11)

- Tasks with a defined state machine, assignees, due dates and expiry. Approving a task runs the underlying action once.
- Email approval links are single-use, scoped to allowed actions, expire, and are revoked when a sibling link is used. Opening a link never changes anything; only a button press does.
- Automation control center: persistent per-business rules with schedules in the business time zone (DST-safe), last and next run, failures and health.
- Background jobs in Postgres with idempotency keys, `SKIP LOCKED` claiming, exponential backoff, timeouts and stale-job reclaim.

## 13. Integrations and account management (blueprint 12)

- OAuth with PKCE where supported, minimum scopes, state stored server-side, tokens encrypted at rest, refresh and health checks, disconnect with token revocation.
- Multiple Google accounts per organization; link a location to a business after server-side re-verification.
- Agency connection invites: a client authorizes a connection through a single-use link without an account.

## 14. Reports (blueprint 13)

- Monthly and on-demand reports. Each metric shows its source (Google, LocalPilot, user assumption) and period. Missing data is shown as missing, never as zero.
- Estimated value only from a user-entered assumption and labeled as an estimate.
- On-demand reports consume credits; the ledger charges exactly once even under concurrent requests. Credits are adjusted manually by owners (no billing provider).
- Delivery by email to validated recipients; the report HTML is rendered in a sandboxed frame.

## 15. Account-manager automations and notifications (blueprint 14)

- Notification preferences per user and type, in-app and email.
- "Needs attention" health signals per client: broken connections, failing automations, overdue tasks, unanswered negative reviews, no recent posts.

## 16. White label and agency (blueprint 16)

- Branding: name, logo, colors, email sender with verification; applied to the app, public pages, emails and reports.
- App domains (white-label host names) and customer website domains.
- Client management, offboarding (disconnect and archive) and per-client approvers.

## 17. Non-functional requirements

- Security: no secrets in the repo; credentials only on the server; least-privilege scopes; CSRF-safe server actions; same-origin redirect checks; rate limits on sign-in, public forms and approval links; HMAC-signed media links; sandboxed report HTML; CSP sandbox on user media.
- Reliability: idempotent jobs, retries with backoff, timeouts, stale-job recovery, publication de-duplication.
- Privacy: suppression lists, unsubscribe in one click on a confirmation page, contact data scoped per org.
- Accessibility: labeled form controls, keyboard-usable controls, sufficient contrast.
