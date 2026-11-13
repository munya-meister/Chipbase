import type { FastifyInstance } from 'fastify';
import type pg from 'pg';

type Developer = { id: string } | null;
type GetUser = (cookie?: string) => Promise<Developer>;

// Phase 04: one private PostgreSQL schema per developer project.
// This does NOT create separate databases, credentials, storage or public data APIs.
export async function registerProjectProvisioning(server: FastifyInstance, pool: pg.Pool | null, getUser: GetUser) {
  if (pool) {
    await pool.query(`CREATE TABLE IF NOT EXISTS project_databases (
      project_id uuid PRIMARY KEY REFERENCES developer_projects(id) ON DELETE CASCADE,
      schema_name text NOT NULL UNIQUE,
      provisioned_at timestamptz NOT NULL DEFAULT now()
    )`);
  }
  const schemaName = (id: string) => 'cb_' + id.replace(/-/g, '');
  const validId = (id: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

  server.get<{Params:{id:string}}>('/api/developer/projects/:id/database', async (request, reply) => {
    try {
      const user = await getUser(request.headers.cookie);
      if (!user) return reply.code(401).send({error:'Not signed in'});
      if (!validId(request.params.id)) return reply.code(400).send({error:'Invalid project ID'});
      if (!pool) return reply.code(503).send({error:'Database unavailable'});
      const result = await pool.query(
        `SELECT p.id,p.status,d.schema_name,d.provisioned_at
         FROM developer_projects p LEFT JOIN project_databases d ON d.project_id=p.id
         WHERE p.id=$1 AND p.developer_id=$2`, [request.params.id,user.id]);
      if (!result.rowCount) return reply.code(404).send({error:'Project not found'});
      const row = result.rows[0];
      return {database:{status:row.schema_name?'ready':'not_provisioned',schema_name:row.schema_name,provisioned_at:row.provisioned_at}};
    } catch {
      return reply.code(503).send({error:'Unable to retrieve database status'});
    }
  });

  server.post<{Params:{id:string}}>('/api/developer/projects/:id/provision', async (request, reply) => {
    const user = await getUser(request.headers.cookie);
    if (!user) return reply.code(401).send({error:'Not signed in'});
    const id = request.params.id;
    if (!validId(id)) return reply.code(400).send({error:'Invalid project ID'});
    if (!pool) return reply.code(503).send({error:'Database unavailable'});
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const owned = await client.query('SELECT id FROM developer_projects WHERE id=$1 AND developer_id=$2 FOR UPDATE',[id,user.id]);
      if (!owned.rowCount) {
        await client.query('ROLLBACK');
        return reply.code(404).send({error:'Project not found'});
      }
      const name = schemaName(id);
      // Derived only from a validated UUID, never from user-supplied SQL identifiers.
      await client.query('CREATE SCHEMA IF NOT EXISTS "'+name+'"');
      await client.query('REVOKE ALL ON SCHEMA "'+name+'" FROM PUBLIC');
      await client.query(
        'INSERT INTO project_databases(project_id,schema_name) VALUES($1,$2) ON CONFLICT(project_id) DO NOTHING',[id,name]);
      await client.query("UPDATE developer_projects SET status='ready' WHERE id=$1 AND developer_id=$2",[id,user.id]);
      await client.query('COMMIT');
      return reply.code(200).send({database:{status:'ready',schema_name:name},message:'Private project schema provisioned. Public database access is not enabled.'});
    } catch (error) {
      try {await client.query('ROLLBACK');} catch {}
      const code = typeof error==='object'&&error!==null&&'code' in error&&typeof error.code==='string'?error.code:'UNKNOWN';
      server.log.error({databaseErrorCode:code},'Project schema provisioning failed');
      return reply.code(503).send({error:'Unable to provision project schema'});
    } finally {
      client.release();
    }
  });
}
