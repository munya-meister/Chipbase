# Chipbase v0.4.0 — Developer projects preview

GitHub OAuth login, persistent developer accounts and **per-developer project metadata** are supported. Each developer can list and create only their own project records via cookie-authenticated endpoints. Admin project records remain separate.

## GitHub App installation

Install at https://github.com/apps/chipbase-cloud/installations/new and select specific repositories. **Installation does not yet connect a repository to a project**. App installation token exchange, installation ownership verification and repository linking are the next milestone. Do not claim repository sync or provisioning works yet.

## API

- GET /api/developer/me
- GET /api/developer/projects
- POST /api/developer/projects — {name, slug}
- GET /api/developer/github-install — installation link
- POST /api/developer/logout
- Admin endpoints /api/projects remain admin-only.

## Deploy

Render API requires DATABASE_URL, CHIPBASE_ADMIN_TOKEN (32+ random chars), GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET. Keep the GitHub App private key server-side. Build: `npm install --include=dev && npm run build --workspace @chipbase/api`. Start: `npm run start --workspace @chipbase/api`.

Vercel root: `apps/dashboard`. Rewrites proxy /api/* to Render. GitHub login uses a one-time ticket redeemed on the dashboard origin. The session cookie is HttpOnly, Secure and SameSite=Lax.

## Limitations

Projects are **metadata only**, not provisioned databases. No project API keys, tenant data stores, repository linkage or webhook processing. Do not expose project provisioning to the public before authorization, rate limiting and quota controls are implemented.
