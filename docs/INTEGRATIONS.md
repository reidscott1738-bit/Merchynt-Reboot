# Integrations

Each integration is optional. When its settings are missing the app says so on the Integrations screen, names the environment variables it needs, and blocks the feature. Only when `DEMO_MODE=true` does it use a demo adapter, whose results are flagged `is_demo`, badged in the UI and kept off public pages.

None of these has been verified against a live account yet: no credentials were available while building. The code follows each provider's public documentation; the links below are where to confirm details before going live.

## Shared behavior

- **Server only.** Every call runs on the server (`src/server/integrations`). Client IDs, secrets and tokens are never sent to the browser.
- **OAuth.** `src/server/integrations/oauth.ts` keeps state and the PKCE verifier (where the provider supports PKCE) in `oauth_states`, single-use with a short expiry. The redirect URI is `${APP_URL}/api/oauth/{provider}/callback`. Tokens are encrypted with AES-256-GCM using `ENCRYPTION_KEY`.
- **Refresh and health.** Expired access tokens are refreshed on use; a failed refresh marks the connection `expired` or `error` and notifies the org. Health checks can be run from Settings → Connections. Disconnecting revokes the token at Google and Meta where the provider offers revocation.
- **Errors.** `httpJson` raises `ProviderAuthError` for 401/403 (treated as a broken connection and not retried) and `TransientError` for network errors, 408, 429 and 5xx, honoring `Retry-After` (the job retries with backoff).
- **Outbound fetches of user-supplied URLs** (site audits, fact extraction) go through `safeFetch`, which rejects private and loopback addresses, limits redirects, size and time.

## Providers

| Provider | Used for | Env vars | Scopes / endpoints | Docs |
|---|---|---|---|---|
| Google Business Profile | Account and location discovery, profile read and update, attributes, reviews and replies, local posts, photos, performance metrics | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | `openid email profile https://www.googleapis.com/auth/business.manage`; Account Management v1, Business Information v1, My Business v4 (reviews, posts, media), Business Profile Performance v1 | https://developers.google.com/my-business/content/prereqs |
| YouTube | Video upload (resumable), channel lookup | same Google client | `youtube.upload`, `youtube.readonly` | https://developers.google.com/youtube/v3/guides/uploading_a_video |
| Facebook Pages | Page posts and videos | `META_APP_ID`, `META_APP_SECRET` | `pages_show_list pages_read_engagement pages_manage_posts`; Graph API v21.0, long-lived user token, then page token | https://developers.facebook.com/docs/pages-api/posts |
| Instagram (business, via a Facebook Page) | Image and video posts via media containers | same Meta app | `pages_show_list instagram_basic instagram_content_publish business_management` | https://developers.facebook.com/docs/instagram-platform/content-publishing |
| LinkedIn Pages | Organization posts with images | `LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET` | `w_organization_social r_organization_social rw_organization_admin`; REST Posts API | https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api |
| CompanyCam | Importing recent job photos into the media library | `COMPANYCAM_CLIENT_ID`, `COMPANYCAM_CLIENT_SECRET` | OAuth; `api.companycam.com/v2` photos | https://docs.companycam.com/docs/authentication |
| DataForSEO | Grid ranking audits (Google Maps SERP per grid point) and keyword search volume | `DATAFORSEO_LOGIN`, `DATAFORSEO_PASSWORD` | `serp/google/maps/live/advanced`, `keywords_data/google_ads/search_volume/live` | https://docs.dataforseo.com/v3/ |
| Anthropic | All AI writing: posts, replies, descriptions, website copy, FAQs, video scripts, alt text, fact extraction | `ANTHROPIC_API_KEY`, `AI_MODEL` | Messages API via `@anthropic-ai/sdk` | https://docs.claude.com |
| OpenAI | AI visibility audit answers | `OPENAI_API_KEY`, `AI_VISIBILITY_OPENAI_MODEL` | Responses API | https://platform.openai.com/docs |
| Google Gemini | AI visibility audit answers | `GEMINI_API_KEY`, `AI_VISIBILITY_GEMINI_MODEL` | `generateContent` | https://ai.google.dev/gemini-api/docs |
| Perplexity | AI visibility audit answers | `PERPLEXITY_API_KEY`, `AI_VISIBILITY_PERPLEXITY_MODEL` | Chat completions | https://docs.perplexity.ai |
| ElevenLabs | Video narration | `ELEVENLABS_API_KEY`, `ELEVENLABS_MODEL` | `text-to-speech/{voice}` | https://elevenlabs.io/docs |
| SMTP | Approval emails, invites, review requests, reports | `SMTP_URL`, `EMAIL_FROM` | Any SMTP relay | — |

## Least privilege

- Each provider requests only the scopes in the table above. YouTube is a separate connection so a business that only uses Google Business Profile never grants upload access.
- Agencies can send a **connection invite**: the business owner authorizes their own account through a single-use link, and the agency never sees their password.
- Linking a discovered Google location, Facebook Page or LinkedIn organization to a business re-checks on the server that the connected account can access it.

## Going live: what each needs

1. **Google**: a Google Cloud project with the Business Profile APIs enabled (access must be requested from Google and approved), an OAuth consent screen that lists `business.manage`, and the redirect URIs above. YouTube upload of public videos needs an audited project; until then uploads are private.
2. **Meta**: a Meta app with Facebook Login, the page and Instagram permissions above, and App Review for those permissions.
3. **LinkedIn**: an app with the Community Management API product approved.
4. **CompanyCam**: an OAuth app from CompanyCam.
5. **DataForSEO**: an account with credit. Each grid point is one SERP request; a 7×7 grid is 49 requests per keyword.
6. **AI providers**: API keys with billing enabled.
7. **SMTP**: a relay with SPF and DKIM set for the sender domain.

## What is not integrated

- AI image generation: no provider is wired in. The post setting for AI images says so, and posts go out without an image instead.
- Billing: report credits are granted by owners manually.
- Review filing with Google: removal requests are tracked here, and the user files them in Google.
