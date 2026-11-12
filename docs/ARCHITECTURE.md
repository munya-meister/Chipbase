# Chipbase MVP architecture

## Separation

- Control plane: authenticated dashboard, project metadata, provisioning workflows, audit logs.
- Data plane: separately provisioned PostgreSQL databases, project REST APIs and project-scoped auth.
- Storage plane: future S3-compatible object storage and access controls.

## Phase 1 (included)

React dashboard, Fastify API, PostgreSQL metadata, read-only local project list and health endpoint. **Not ready for public hosting.**

## Phase 2

Server-side admin authentication and session management. Audited project creation and deletion. Provision a dedicated logical PostgreSQL database per project with least-privilege roles. Validate identifiers and parameterize data. Keep provisioning permissions away from the application-facing API.

## Phase 3

Authorized table editing, schema migrations, protected CRUD endpoints, API-key rotation and rate limiting. Never treat a public API key as permission to access records. Deny access by default.

## Phase 4

User authentication per project, object storage, backup and restore drills, audit logs, metrics, incident response and resource quotas.

## Public beta readiness

External security assessment, multi-tenant isolation tests, automated provisioning and recovery, billing and abuse protection are required before accepting third-party production data.
