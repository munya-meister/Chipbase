-- Phase 04: metadata for private per-project schemas.
-- Each project gets a PostgreSQL schema, not a dedicated database.
-- Provisioning runs only through the authenticated API.
CREATE TABLE IF NOT EXISTS project_databases (
  project_id uuid PRIMARY KEY REFERENCES developer_projects(id) ON DELETE CASCADE,
  schema_name text NOT NULL UNIQUE,
  provisioned_at timestamptz NOT NULL DEFAULT now()
);
