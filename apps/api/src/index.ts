import Fastify from 'fastify';
import pg from 'pg';
const server = Fastify({logger:true});
const pool = new pg.Pool({connectionString:process.env.DATABASE_URL,connectionTimeoutMillis:3000,max:5});
server.get('/health',async()=>{try{await pool.query('SELECT 1');return {service:'chipbase',status:'ok',database:'connected'};}catch{return {service:'chipbase',status:'degraded',database:'unavailable'};}});
// Read-only preview: do not expose mutations without admin auth and tenant isolation.
server.get('/api/projects',async(_req,reply)=>{try{const result=await pool.query('SELECT id,name,slug,status,created_at FROM projects ORDER BY created_at DESC LIMIT 100');return {projects:result.rows};}catch{return reply.code(503).send({error:'Database unavailable'});}});
server.get('/api/platform',async()=>({name:'Chipbase',version:'0.1.0',status:'development-preview'}));
const shutdown=async()=>{await server.close();await pool.end();};
process.on('SIGINT',()=>{void shutdown().then(()=>process.exit(0));});
process.on('SIGTERM',()=>{void shutdown().then(()=>process.exit(0));});
await server.listen({port:Number(process.env.API_PORT||4000),host:'127.0.0.1'});
