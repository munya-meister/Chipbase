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
  // Restricted database studio: owner-only, allowlisted identifiers and column types.
  const identifier = (s:string) => /^[a-z][a-z0-9_]{0,47}$/.test(s);
  const quoted = (s:string) => '"'+s+'"';
  const resolveSchema = async(id:string,userId:string) => {
    if(!pool||!validId(id))return null;
    const r=await pool.query(`SELECT d.schema_name FROM project_databases d
      JOIN developer_projects p ON p.id=d.project_id
      WHERE p.id=$1 AND p.developer_id=$2`,[id,userId]);
    return r.rows[0]?.schema_name as string|undefined;
  };
  const types:Record<string,string>={text:'text',integer:'integer',boolean:'boolean',numeric:'numeric',timestamp:'timestamptz',uuid:'uuid'};
  server.get<{Params:{id:string}}>('/api/developer/projects/:id/tables',async(request,reply)=>{
    try {
      const user=await getUser(request.headers.cookie);
      if(!user)return reply.code(401).send({error:'Not signed in'});
      const schema=await resolveSchema(request.params.id,user.id);
      if(!schema)return reply.code(404).send({error:'Provisioned project not found'});
      const r=await pool!.query(`SELECT table_name,column_name,data_type,is_nullable,ordinal_position
        FROM information_schema.columns WHERE table_schema=$1 ORDER BY table_name,ordinal_position`,[schema]);
      const grouped:Record<string,{name:string;columns:{name:string;type:string;nullable:boolean}[]}>=Object.create(null);
      for(const row of r.rows){
        if(!Object.hasOwn(grouped,row.table_name))grouped[row.table_name]={name:row.table_name,columns:[]};
        grouped[row.table_name].columns.push({name:row.column_name,type:row.data_type,nullable:row.is_nullable==='YES'});
      }
      return {tables:Object.values(grouped)};
    }catch{return reply.code(503).send({error:'Unable to list database tables'});}
  });
  server.post<{Params:{id:string};Body:{name:string;columns:{name:string;type:string}[]}}>('/api/developer/projects/:id/tables',{
    schema:{body:{type:'object',additionalProperties:false,required:['name','columns'],properties:{
      name:{type:'string',minLength:1,maxLength:48},
      columns:{type:'array',minItems:1,maxItems:20,items:{type:'object',additionalProperties:false,required:['name','type'],properties:{name:{type:'string',minLength:1,maxLength:48},type:{type:'string',enum:['text','integer','boolean','numeric','timestamp','uuid']}}}}
    }}}
  },async(request,reply)=>{
    try {
      const user=await getUser(request.headers.cookie);
      if(!user)return reply.code(401).send({error:'Not signed in'});
      const db=await resolveSchema(request.params.id,user.id);
      if(!db)return reply.code(404).send({error:'Provisioned project not found'});
      const {name,columns}=request.body;
      if(!identifier(name)||!columns.every(c=>identifier(c.name)&&types[c.type])||new Set(columns.map(c=>c.name)).size!==columns.length||columns.some(c=>c.name==='id'))return reply.code(400).send({error:'Invalid table or column names'});
      const defs=['"id" uuid PRIMARY KEY DEFAULT gen_random_uuid()',...columns.map(c=>quoted(c.name)+' '+types[c.type])];
      await pool!.query('CREATE TABLE '+quoted(db)+'.'+quoted(name)+' ('+defs.join(',')+')');
      return reply.code(201).send({table:name});
    }catch(error){
      if(typeof error==='object'&&error!==null&&'code' in error&&error.code==='42P07')return reply.code(409).send({error:'Table already exists'});
      server.log.error('Database studio table creation failed');
      return reply.code(503).send({error:'Unable to create table'});
    }
  });
  server.get<{Params:{id:string;table:string}}>('/api/developer/projects/:id/tables/:table/rows',async(request,reply)=>{
    try{
      const user=await getUser(request.headers.cookie);
      if(!user)return reply.code(401).send({error:'Not signed in'});
      const db=await resolveSchema(request.params.id,user.id);
      if(!db)return reply.code(404).send({error:'Provisioned project not found'});
      const name=request.params.table;
      if(!identifier(name))return reply.code(400).send({error:'Invalid table name'});
      const exists=await pool!.query(`SELECT 1 FROM information_schema.tables WHERE table_schema=$1 AND table_name=$2 AND table_type='BASE TABLE'`,[db,name]);
      if(!exists.rowCount)return reply.code(404).send({error:'Table not found'});
      const result=await pool!.query('SELECT * FROM '+quoted(db)+'.'+quoted(name)+' LIMIT 100');
      return {rows:result.rows,limit:100};
    }catch{return reply.code(503).send({error:'Unable to retrieve rows'});}
  });

}
