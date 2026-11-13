import Fastify from 'fastify';
import pg from 'pg';
import { registerGithubAuth } from './github-auth.js';
import { createHash, timingSafeEqual } from 'node:crypto';

const server = Fastify({ logger: true });
const databaseUrl = process.env.DATABASE_URL;
const pool = databaseUrl ? new pg.Pool({ connectionString: databaseUrl, connectionTimeoutMillis: 5000, max: 5 }) : null;
const adminToken = process.env.CHIPBASE_ADMIN_TOKEN;
const digest = (value: string) => createHash('sha256').update(value).digest();
const authorized = (header?: string) => {
  if (!adminToken || adminToken.length < 32 || !header?.startsWith('Bearer ')) return false;
  return timingSafeEqual(digest(header.slice(7)), digest(adminToken));
};
const requireAdmin = async (request: { headers: { authorization?: string } }, reply: { code: (status: number) => { send: (body: object) => unknown } }) => {
  if (!authorized(request.headers.authorization)) return reply.code(401).send({ error: 'Unauthorized' });
};
const initialize = async () => {
  if (!pool) return;
  await pool.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto;
    CREATE TABLE IF NOT EXISTS projects (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z][a-z0-9-]{2,47}$'),
      name text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
      status text NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','provisioning','ready','failed','suspended')),
      created_at timestamptz NOT NULL DEFAULT now()
    )`);
};
await registerGithubAuth(server, pool);
server.get('/health', async (_request, reply) => {
  if (!pool) return reply.code(503).send({ service: 'chipbase', status: 'degraded', database: 'not_configured' });
  try {
    await pool.query('SELECT 1');
    return { service: 'chipbase', status: 'ok', database: 'connected' };
  } catch (error) {
    const code = typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string' ? error.code : 'UNKNOWN';
    const allowed = new Set(['ENOTFOUND','EAI_AGAIN','ECONNREFUSED','ETIMEDOUT','ECONNRESET','28P01','28000','3D000','57P03','53300','08006','08001']);
    server.log.error({ databaseErrorCode: allowed.has(code) ? code : 'OTHER' }, 'Database health check failed');
    return reply.code(503).send({ service: 'chipbase', status: 'degraded', database: 'unavailable' });
  }
});
server.post('/api/admin/session', { preHandler: requireAdmin }, async () => ({ authenticated: true }));
server.get('/api/projects', { preHandler: requireAdmin }, async (_request, reply) => {
  if (!pool) return reply.code(503).send({ error: 'Database not configured' });
  try { const result = await pool.query('SELECT id, name, slug, status, created_at FROM projects ORDER BY created_at DESC LIMIT 100'); return { projects: result.rows }; }
  catch { return reply.code(503).send({ error: 'Unable to load projects' }); }
});
server.post<{ Body: { name?: string; slug?: string } }>('/api/projects', { preHandler: requireAdmin, schema: { body: { type: 'object', required: ['name','slug'], additionalProperties: false, properties: { name: { type: 'string', minLength: 1, maxLength: 120 }, slug: { type: 'string', pattern: '^[a-z][a-z0-9-]{2,47}$' } } } } }, async (request, reply) => {
  if (!pool) return reply.code(503).send({ error: 'Database not configured' });
  const name = request.body.name?.trim();
  if (!name) return reply.code(400).send({ error: 'Project name is required' });
  try {
    const result = await pool.query('INSERT INTO projects (name, slug) VALUES ($1, $2) RETURNING id, name, slug, status, created_at', [name, request.body.slug]);
    return reply.code(201).send({ project: result.rows[0] });
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === '23505') return reply.code(409).send({ error: 'Project slug already exists' });
    return reply.code(500).send({ error: 'Unable to create project' });
  }
});
server.get('/api/platform', async () => ({ name: 'Chipbase', version: '0.3.0', status: 'developer-auth-preview' }));
const shutdown = async () => { await server.close(); if (pool) await pool.end(); };
process.on('SIGINT', () => { void shutdown().then(() => process.exit(0)); });
process.on('SIGTERM', () => { void shutdown().then(() => process.exit(0)); });
if (pool) { try { await initialize(); } catch { server.log.error('Project schema initialization failed'); } }
await server.listen({ port: Number(process.env.PORT || process.env.API_PORT || 4000), host: process.env.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1' });
