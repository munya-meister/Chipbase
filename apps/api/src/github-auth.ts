import { registerProjectProvisioning } from './project-provisioning.js';
import { randomBytes, createHash, timingSafeEqual, createSign } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';

const appId = process.env.GITHUB_APP_ID;
const privateKey = process.env.GITHUB_APP_PRIVATE_KEY?.replace(/\\n/g, '\n');
const githubApi = async (url: string, token: string, options: {method?:string} = {}) => {
  const response = await fetch(url, {method:options.method || 'GET',headers:{Accept:'application/vnd.github+json',Authorization:'Bearer '+token,'User-Agent':'Chipbase-Cloud','X-GitHub-Api-Version':'2022-11-28'},signal:AbortSignal.timeout(12000)});
  if (!response.ok) throw new Error('GitHub API request failed: '+response.status);
  return response.json() as Promise<any>;
};
const appJwt = () => {
  if (!appId || !privateKey) throw new Error('GitHub App credentials missing');
  const now = Math.floor(Date.now()/1000);
  const encode = (value:object) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const unsigned = encode({alg:'RS256',typ:'JWT'})+'.'+encode({iat:now-60,exp:now+540,iss:appId});
  const signer = createSign('RSA-SHA256');signer.update(unsigned);signer.end();
  return unsigned+'.'+signer.sign(privateKey,'base64url');
};
const allowedRepositories = async (githubId:string) => {
  const jwt = appJwt();
  const installations = await githubApi('https://api.github.com/app/installations?per_page=100',jwt) as any[];
  const owned = installations.filter(i=>String(i.account?.id)===String(githubId));
  const repositories: {id:number;full_name:string;private:boolean;installation_id:number}[] = [];
  for (const installation of owned) {
    const token = await githubApi('https://api.github.com/app/installations/'+installation.id+'/access_tokens',jwt,{method:'POST'});
    for (let page=1;page<=10;page++) {
      const result = await githubApi('https://api.github.com/installation/repositories?per_page=100&page='+page,token.token);
      for(const r of result.repositories || []) repositories.push({id:r.id,full_name:r.full_name,private:r.private,installation_id:installation.id});
      if((result.repositories || []).length<100)break;
    }
  }
  return repositories;
};
const clientId = process.env.GITHUB_CLIENT_ID;
const clientSecret = process.env.GITHUB_CLIENT_SECRET;
const callback = 'https://chipbase-api.onrender.com/auth/github/callback';
const dashboard = 'https://chipbase-munyaradzi.vercel.app';
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
const cookie = (name: string, value: string, maxAge: number, path: string) => `${name}=${value}; Path=${path}; Max-Age=${maxAge}; Secure; HttpOnly; SameSite=Lax`;
const readCookie = (header: string | undefined, name: string) => header?.split(';').map(s=>s.trim()).find(s=>s.startsWith(name+'='))?.slice(name.length+1);
const safeEqual = (a: string, b: string) => {const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&timingSafeEqual(x,y);};
const valid = (v: unknown): v is string => typeof v === 'string' && v.length>0 && v.length<1000;
const githubFetch = async (url: string, token: string) => {
  const r=await fetch(url,{headers:{'Accept':'application/vnd.github+json','Authorization':'Bearer '+token,'User-Agent':'Chipbase-Cloud','X-GitHub-Api-Version':'2022-11-28'},signal:AbortSignal.timeout(10000)});
  if(!r.ok)throw new Error('GitHub request failed');
  return r.json() as Promise<any>;
};
export async function registerGithubAuth(server: FastifyInstance, pool: pg.Pool | null) {
  if (pool) {
    try {
      await pool.query(`CREATE TABLE IF NOT EXISTS developer_accounts (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        github_user_id bigint NOT NULL UNIQUE,
        login text NOT NULL,
        display_name text,
        avatar_url text,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS developer_sessions (
        token_hash text PRIMARY KEY,
        developer_id uuid NOT NULL REFERENCES developer_accounts(id) ON DELETE CASCADE,
        expires_at timestamptz NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS github_login_tickets (
        ticket_hash text PRIMARY KEY,
        developer_id uuid NOT NULL REFERENCES developer_accounts(id) ON DELETE CASCADE,
        expires_at timestamptz NOT NULL
      );
      CREATE TABLE IF NOT EXISTS github_oauth_states (
        state_hash text PRIMARY KEY,
        expires_at timestamptz NOT NULL
      );
      CREATE TABLE IF NOT EXISTS developer_projects (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        developer_id uuid NOT NULL REFERENCES developer_accounts(id) ON DELETE CASCADE,
        name text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
        slug text NOT NULL CHECK (slug ~ '^[a-z][a-z0-9-]{2,47}$'),
        status text NOT NULL DEFAULT 'planned',
        created_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (developer_id,slug)
      )`);
    } catch { server.log.error('Developer schema initialization failed'); }
  }
  if (pool) {
    try {await pool.query('ALTER TABLE developer_projects ADD COLUMN IF NOT EXISTS github_repository_id bigint; ALTER TABLE developer_projects ADD COLUMN IF NOT EXISTS github_repository_full_name text; ALTER TABLE developer_projects ADD COLUMN IF NOT EXISTS github_installation_id bigint');}
    catch {server.log.error('Repository link schema migration failed');}
  }
  const getUser = async (header?: string) => {
    const session = readCookie(header, 'chipbase_session');
    if (!pool || !valid(session)) return null;
    const result = await pool.query(`SELECT a.id,a.login,a.display_name,a.avatar_url,a.github_user_id
      FROM developer_sessions s JOIN developer_accounts a ON a.id=s.developer_id
      WHERE s.token_hash=$1 AND s.expires_at>now()`, [hash(session)]);
    return result.rows[0] || null;
  };
  await registerProjectProvisioning(server, pool, getUser);
  server.get('/auth/github/start', async (_request, reply) => {
    if (!pool || !clientId || !clientSecret) return reply.code(503).send({error:'GitHub login unavailable'});
    const state = randomBytes(32).toString('hex');
    await pool.query("INSERT INTO github_oauth_states(state_hash,expires_at) VALUES($1,now()+interval '10 minutes')", [hash(state)]);
    reply.header('Set-Cookie', cookie('chipbase_oauth_state',state,600,'/auth/github'));
    return reply.redirect('https://github.com/login/oauth/authorize?'+new URLSearchParams({client_id:clientId,redirect_uri:callback,state}).toString());
  });
  server.get<{Querystring:{code?:string;state?:string}}>('/auth/github/callback', async (request,reply) => {
    const state=readCookie(request.headers.cookie,'chipbase_oauth_state');
    reply.header('Set-Cookie',cookie('chipbase_oauth_state','',0,'/auth/github'));
    const fail=(reason:string)=>reply.redirect(dashboard+'/?github_error='+encodeURIComponent(reason));
    if(!pool||!clientId||!clientSecret||!valid(state)||!valid(request.query.state)||!safeEqual(state,request.query.state)||!valid(request.query.code))return fail('authorization_failed');
    try {
      const used=await pool.query('DELETE FROM github_oauth_states WHERE state_hash=$1 AND expires_at>now() RETURNING state_hash',[hash(state)]);
      if(used.rowCount!==1)return fail('expired_state');
      const response=await fetch('https://github.com/login/oauth/access_token',{method:'POST',headers:{Accept:'application/json','Content-Type':'application/json','User-Agent':'Chipbase-Cloud'},body:JSON.stringify({client_id:clientId,client_secret:clientSecret,code:request.query.code,redirect_uri:callback}),signal:AbortSignal.timeout(10000)});
      if(!response.ok)return fail('token_exchange_failed');
      const result=await response.json() as {access_token?:string};
      if(!result.access_token)return fail('token_exchange_failed');
      const user=await githubFetch('https://api.github.com/user',result.access_token);
      if(typeof user.id!=='number'||typeof user.login!=='string')return fail('invalid_github_profile');
      const saved=await pool.query(`INSERT INTO developer_accounts(github_user_id,login,display_name,avatar_url)
        VALUES($1,$2,$3,$4) ON CONFLICT(github_user_id) DO UPDATE SET
        login=EXCLUDED.login,display_name=EXCLUDED.display_name,avatar_url=EXCLUDED.avatar_url,updated_at=now()
        RETURNING id`,[user.id,user.login,user.name||null,user.avatar_url||null]);
      const ticket=randomBytes(32).toString('hex');
      await pool.query("INSERT INTO github_login_tickets(ticket_hash,developer_id,expires_at) VALUES($1,$2,now()+interval '2 minutes')",[hash(ticket),saved.rows[0].id]);
      return reply.redirect(dashboard+'/?github_ticket='+encodeURIComponent(ticket));
    } catch {server.log.error('GitHub OAuth callback failed');return fail('server_error');}
  });
  server.post<{Body:{ticket:string}}>('/api/developer/exchange',{schema:{body:{type:'object',required:['ticket'],additionalProperties:false,properties:{ticket:{type:'string',minLength:64,maxLength:64}}}}},async(request,reply)=>{
    if(!pool||!valid(request.body.ticket))return reply.code(401).send({error:'Invalid login ticket'});
    const found=await pool.query('DELETE FROM github_login_tickets WHERE ticket_hash=$1 AND expires_at>now() RETURNING developer_id',[hash(request.body.ticket)]);
    if(found.rowCount!==1)return reply.code(401).send({error:'Expired login ticket'});
    const session=randomBytes(32).toString('hex');
    await pool.query("INSERT INTO developer_sessions(token_hash,developer_id,expires_at) VALUES($1,$2,now()+interval '7 days')",[hash(session),found.rows[0].developer_id]);
    reply.header('Set-Cookie',cookie('chipbase_session',session,604800,'/'));
    return {authenticated:true};
  });
  server.get('/api/developer/me',async(request,reply)=>{
    try {const user=await getUser(request.headers.cookie);if(!user)return reply.code(401).send({error:'Not signed in'});return {user};}
    catch{return reply.code(503).send({error:'Session unavailable'});}
  });
  server.get('/api/developer/projects',async(request,reply)=>{
    try {const user=await getUser(request.headers.cookie);if(!user)return reply.code(401).send({error:'Not signed in'});
      const result=await pool!.query('SELECT id,name,slug,status,created_at,github_repository_id,github_repository_full_name FROM developer_projects WHERE developer_id=$1 ORDER BY created_at DESC LIMIT 100',[user.id]);
      return {projects:result.rows};
    }catch{return reply.code(503).send({error:'Unable to load projects'});}
  });
  server.post<{Body:{name:string;slug:string}}>('/api/developer/projects',{schema:{body:{type:'object',required:['name','slug'],additionalProperties:false,properties:{name:{type:'string',minLength:1,maxLength:120},slug:{type:'string',pattern:'^[a-z][a-z0-9-]{2,47}$'}}}}},async(request,reply)=>{
    try {const user=await getUser(request.headers.cookie);if(!user)return reply.code(401).send({error:'Not signed in'});
      const name=request.body.name.trim();if(!name)return reply.code(400).send({error:'Project name required'});
      const result=await pool!.query('INSERT INTO developer_projects(developer_id,name,slug) VALUES($1,$2,$3) RETURNING id,name,slug,status,created_at',[user.id,name,request.body.slug]);
      return reply.code(201).send({project:result.rows[0]});
    }catch(error){if(typeof error==='object'&&error!==null&&'code' in error&&error.code==='23505')return reply.code(409).send({error:'Project slug already exists'});return reply.code(503).send({error:'Unable to create project'});}
  });
  server.get('/api/developer/repositories',async(request,reply)=>{
    try {const user=await getUser(request.headers.cookie);if(!user)return reply.code(401).send({error:'Not signed in'});
      return {repositories:await allowedRepositories(user.github_user_id)};
    } catch {return reply.code(503).send({error:'Cannot retrieve GitHub repositories. Check App ID and private key on Render.'});}
  });
  server.post<{Params:{id:string};Body:{repository_id:number}}>('/api/developer/projects/:id/repository',{
    schema:{params:{type:'object',required:['id'],properties:{id:{type:'string',format:'uuid'}}},body:{type:'object',required:['repository_id'],additionalProperties:false,properties:{repository_id:{type:'integer',minimum:1}}}}
  },async(request,reply)=>{
    try {
      const user=await getUser(request.headers.cookie);if(!user)return reply.code(401).send({error:'Not signed in'});
      const permitted=(await allowedRepositories(user.github_user_id)).find(r=>r.id===request.body.repository_id);
      if(!permitted)return reply.code(403).send({error:'Repository not authorized for this GitHub account'});
      const updated=await pool!.query('UPDATE developer_projects SET github_repository_id=$1,github_repository_full_name=$2,github_installation_id=$3 WHERE id=$4 AND developer_id=$5 RETURNING id,name,slug,status,github_repository_full_name',[permitted.id,permitted.full_name,permitted.installation_id,request.params.id,user.id]);
      if(!updated.rowCount)return reply.code(404).send({error:'Project not found'});
      return {project:updated.rows[0]};
    }catch{return reply.code(503).send({error:'Unable to link repository'});}
  });
  server.get('/api/developer/github-install',async(request,reply)=>{
    const user=await getUser(request.headers.cookie);if(!user)return reply.code(401).send({error:'Not signed in'});
    return {url:'https://github.com/apps/chipbase-cloud/installations/new'};
  });
  server.post('/api/developer/logout',async(request,reply)=>{
    const session=readCookie(request.headers.cookie,'chipbase_session');
    if(pool&&valid(session))await pool.query('DELETE FROM developer_sessions WHERE token_hash=$1',[hash(session)]);
    reply.header('Set-Cookie',cookie('chipbase_session','',0,'/'));
    return {ok:true};
  });
}
