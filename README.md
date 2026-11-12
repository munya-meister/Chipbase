# Chipbase

An experimental self-hosted backend-as-a-service platform for our projects, with an eventual developer beta.

## Local development

Requires Node.js 22+, npm and Docker Compose.

1. Copy `.env.example` to `.env` and set a strong PostgreSQL password. Keep the values out of Git.
2. Start PostgreSQL: `docker compose up -d db`
3. Install packages: `npm install`
4. Launch the dashboard and API: `npm run dev`
5. Open http://127.0.0.1:5173 or check http://127.0.0.1:4000/health

**Security:** This is a local-only read-only preview. There is no login, project provisioning, application authentication, or file storage yet. Do not publish these services until admin authentication, isolation, and access control are implemented.

See `docs/ARCHITECTURE.md` for roadmap and security requirements.
