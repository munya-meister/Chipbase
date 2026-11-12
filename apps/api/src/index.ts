import Fastify from 'fastify';
import pg from 'pg';

const server = Fastify({ logger: true });
const databaseUrl = process.env.DATABASE_URL;
const pool = databaseUrl ? new pg.Pool({ connectionString: databaseUrl, connectionTimeoutMillis: 3000, max: 5 }) : null;

server.get('/health', async () => {
  if (!pool) return { service: 'chipbase', status: 'degraded', database: 'not_configured' };
  try {
    await pool.query('SELECT 1');
    return { service: 'chipbase', status: 'ok', database: 'connected' };
  } catch {
    return { service: 'chipbase', status: 'degraded', database: 'unavailable' };
  }
});

// Do not expose project metadata or database operations before authentication.
server.get('/api/projects', async (_request, reply) => reply.code(401).send({ error: 'Authentication required' }));
server.get('/api/platform', async () => ({ name: 'Chipbase', version: '0.1.0', status: 'development-preview' }));

const shutdown = async () => {
  await server.close();
  if (pool) await pool.end();
};
process.on('SIGINT', () => { void shutdown().then(() => process.exit(0)); });
process.on('SIGTERM', () => { void shutdown().then(() => process.exit(0)); });
await server.listen({ port: Number(process.env.PORT || process.env.API_PORT || 4000), host: process.env.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1' });
