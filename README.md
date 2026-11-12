# Chipbase

Self-hosted backend platform (admin preview v0.2).

## Deployment

API on Render: set `DATABASE_URL` to the PostgreSQL **Internal Database URL**. Set `CHIPBASE_ADMIN_TOKEN` to a cryptographically random secret of **at least 32 characters** (e.g. generate locally with `openssl rand -hex 32`). Do not put this token in Git, Vercel environment variables or browser build files. Render build: `npm install --include=dev && npm run build --workspace @chipbase/api`; start: `npm run start --workspace @chipbase/api`.

Dashboard on Vercel: root directory `apps/dashboard`. The `vercel.json` rewrites forward `/api/*` and `/health` to the Render API. After both deploy, open the dashboard, enter the admin token in the sign-in form, and create a project. Token is kept in browser sessionStorage until sign-out or the tab session ends; use only on trusted devices. Use HTTPS.

## Local development

Requires Node.js 22+, npm and Docker Compose. Copy `.env.example` to `.env`, configure PostgreSQL and `CHIPBASE_ADMIN_TOKEN`. Run `docker compose up -d db`, `npm install`, and `npm run dev`. Dashboard at http://127.0.0.1:5173; API at http://127.0.0.1:4000/health.

## Scope and security

The API requires a configured admin bearer token for all project endpoints. Project creation inserts **metadata only**; no per-project database, tenant isolation, user auth, storage, or generated REST API exists yet. Do not expose the admin token to end users or connect untrusted applications directly. Rotate it if compromised. Add rate limiting, audited user accounts, CSRF-aware cookie sessions, and project-level authorization before public beta.
