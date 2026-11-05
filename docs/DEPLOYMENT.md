# Deployment

LocalPilot ships as one Docker image (`Dockerfile`) that runs the web app and the background worker in the same container, so both share one storage volume. `scripts/start.sh` applies database migrations, starts the worker, then serves the app on `$PORT`. If either process exits, the container exits so the host restarts it.

## Railway (recommended)

1. Sign in at railway.com with GitHub, choose **New project → Deploy from GitHub repo**, and pick this repository. Railway reads `railway.json` and builds the Dockerfile.
2. In the project, add **Database → PostgreSQL**.
3. On the app service, add a **Volume** mounted at `/data`.
4. On the app service, open **Settings → Networking → Generate domain**. Note the address, for example `https://localpilot-production.up.railway.app`.
5. On the app service, open **Variables** and set:

| Variable | Value |
|---|---|
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` (Railway's reference to the database) |
| `APP_URL` | the domain from step 4, with `https://` |
| `ENCRYPTION_KEY` | 32 random bytes, base64. Generate with `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`. Keep it safe; changing it breaks stored connections. |
| `STORAGE_DIR` | `/data/storage` |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | from the Google Cloud OAuth client |
| `GEMINI_API_KEY` or `ANTHROPIC_API_KEY` | AI writing |
| `DEMO_MODE` | `false` for real use; `true` only to explore with labeled demo data |
| `SMTP_URL`, `EMAIL_FROM` | optional, to send email |

Other provider keys are listed in `.env.example`.

6. Redeploy. The health check is `GET /api/health`.
7. In Google Cloud Console → Credentials → your OAuth client, add the redirect URI `${APP_URL}/api/oauth/google/callback` (and `/api/oauth/youtube/callback` if you use YouTube).

## Other hosts

Any host that builds a Dockerfile and offers PostgreSQL and a persistent disk works (Render, Fly.io, a VPS). Mount persistent storage and point `STORAGE_DIR` at it, and set the same variables. Customer website domains need a reverse proxy that terminates TLS for those hostnames.
