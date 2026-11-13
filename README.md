# Chipbase

Chipbase v0.3 developer authentication preview. Admin project management is separate from GitHub developer sign-in.

## Render API

Configure `DATABASE_URL`, `CHIPBASE_ADMIN_TOKEN` (32+ random characters), `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET`. The GitHub App redirect URI must be exactly `https://chipbase-api.onrender.com/auth/github/callback`. Keep GitHub secrets and PEM keys server-side only. The GitHub App private key is **not required** for the OAuth login step; it will be used for repository installations later.

Build: `npm install --include=dev && npm run build --workspace @chipbase/api`. Start: `npm run start --workspace @chipbase/api`.

## Vercel dashboard

Root directory `apps/dashboard`. The Vercel rewrites forward `/api/*` and `/health` to the Render API. GitHub OAuth starts on the Render domain, sets an HttpOnly secure cookie there, and redirects to the dashboard. **Important:** Cross-site browser cookie restrictions may prevent the Vercel dashboard from reading that Render cookie via the Vercel proxy. For reliable production login, use a shared custom domain (e.g. dashboard and API subdomains of the same site), or an explicit secure one-time code handoff on the dashboard origin. Until that is implemented, GitHub OAuth is a backend preview and must not be considered production-ready.

## Security / limitations

GitHub access tokens are used transiently to retrieve profile data and are not stored. Login state is one-use and expires after 10 minutes. Developer sessions are random opaque tokens stored hashed in PostgreSQL and expire after 7 days. No developer project provisioning, tenant isolation, GitHub App installations, or repository sync yet. The admin token is not for other developers.
