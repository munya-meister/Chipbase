import {useEffect,useState} from 'react';
import {Activity,Boxes,Database,FolderOpen,HardDrive,KeyRound,Lock,Radio,Server,Settings,ShieldCheck,LogOut} from 'lucide-react';
type Developer={id:string;login:string;display_name:string|null;avatar_url:string|null};
type Project={id:string;name:string;slug:string;status:string;github_repository_full_name?:string|null;github_repository_id?:number|null};
const modules=[{name:'Database',description:'SQL tables and data',icon:Database},{name:'Authentication',description:'Users and access control',icon:KeyRound},{name:'Storage',description:'Buckets and files',icon:HardDrive},{name:'Data API',description:'Project REST endpoints',icon:Server},{name:'Realtime',description:'Live subscriptions',icon:Radio},{name:'Monitoring',description:'Health and logs',icon:Activity}];
const stored=()=>sessionStorage.getItem('chipbase_admin_token')||'';
export default function App(){
 const [databaseStatuses,setDatabaseStatuses]=useState<Record<string,{status:string;schema_name:string|null;provisioned_at:string|null}>>({});
 const [studioProject,setStudioProject]=useState<Project|null>(null);
 const [studioTables,setStudioTables]=useState<{name:string;columns:{name:string;type:string}[]}[]>([]);
 const [studioName,setStudioName]=useState('');
 const [studioColumns,setStudioColumns]=useState<{name:string;type:string}[]>([{name:'title',type:'text'}]);
 const [studioRows,setStudioRows]=useState<Record<string,unknown>[]|null>(null);
 const [studioTable,setStudioTable]=useState<string|null>(null);
 const [studioSearch,setStudioSearch]=useState('');
 const [studioValues,setStudioValues]=useState<Record<string,unknown>>({});
 const [studioEditId,setStudioEditId]=useState<string|null>(null);
 const [pendingDeleteId,setPendingDeleteId]=useState<string|null>(null);
 const [studioBusy,setStudioBusy]=useState(false);
 const [provisioning,setProvisioning]=useState<string|null>(null);
 const [repositories,setRepositories]=useState<{id:number;full_name:string;installation_id:number}[]>([]);
 const [repoBusy,setRepoBusy]=useState(false);
 const [developer,setDeveloper]=useState<Developer|null>(null);const [token,setToken]=useState(stored);const [secret,setSecret]=useState('');const [verified,setVerified]=useState(false);
 const [projects,setProjects]=useState<Project[]>([]);const [online,setOnline]=useState(false);const [page,setPage]=useState('Overview');
 const [name,setName]=useState('');const [slug,setSlug]=useState('');const [creating,setCreating]=useState(false);const [busy,setBusy]=useState(false);const [message,setMessage]=useState('');
 const request=async (path:string,options:RequestInit={},auth=token)=>{const response=await fetch(path,{...options,headers:{...options.headers,Authorization:'Bearer '+auth}});const data=await response.json();if(!response.ok)throw new Error(data.error||'Request failed');return data;};
 const refresh=async(auth=token)=>{const data=await request('/api/projects',{},auth);setProjects(data.projects||[]);};
 const refreshDatabaseStatuses=async(list:Project[])=>{
  const results=await Promise.all(list.map(async p=>{
   try{const r=await fetch('/api/developer/projects/'+encodeURIComponent(p.id)+'/database',{credentials:'include'});
    if(!r.ok)return [p.id,{status:'unavailable',schema_name:null,provisioned_at:null}] as const;
    const j=await r.json();return [p.id,j.database] as const;
   }catch{return [p.id,{status:'unavailable',schema_name:null,provisioned_at:null}] as const;}
  }));
  setDatabaseStatuses(Object.fromEntries(results));
 };
 const refreshDeveloper=async()=>{const r=await fetch('/api/developer/projects',{credentials:'include'});if(!r.ok)throw new Error('Unable to load your projects');const list=(await r.json()).projects||[];setProjects(list);await refreshDatabaseStatuses(list);};
 const studioRequest=async(path:string,options:RequestInit={})=>{
  const r=await fetch(path,{...options,credentials:'include',headers:{'Content-Type':'application/json',...options.headers}});
  const j=await r.json();if(!r.ok)throw new Error(j.error||'Database request failed');return j;
 };
 const openStudio=async(p:Project)=>{
  setStudioProject(p);setPendingDeleteId(null);setStudioTable(null);setStudioRows(null);setStudioValues({});setStudioBusy(true);setMessage('');
  try{const j=await studioRequest('/api/developer/projects/'+p.id+'/tables');setStudioTables(j.tables||[]);}
  catch(e){setMessage((e as Error).message);}finally{setStudioBusy(false);}
 };
 const createStudioTable=async(e:React.FormEvent)=>{
  e.preventDefault();if(!studioProject)return;
  setStudioBusy(true);setMessage('');
  try{await studioRequest('/api/developer/projects/'+studioProject.id+'/tables',{method:'POST',body:JSON.stringify({name:studioName,columns:studioColumns})});
   const j=await studioRequest('/api/developer/projects/'+studioProject.id+'/tables');
   setStudioTables(j.tables||[]);setStudioName('');setStudioColumns([{name:'title',type:'text'}]);setMessage('Table created successfully.');
  }catch(e){setMessage((e as Error).message);}finally{setStudioBusy(false);}
 };
 const refreshRows=async(table:string)=>{
  if(!studioProject)return;
  const j=await studioRequest('/api/developer/projects/'+studioProject.id+'/tables/'+encodeURIComponent(table)+'/rows');
  setStudioRows(j.rows||[]);
 };
 const saveStudioRow=async(e:React.FormEvent)=>{
  e.preventDefault();if(!studioProject||!studioTable)return;
  setStudioBusy(true);setMessage('');
  try{
   const base='/api/developer/projects/'+studioProject.id+'/tables/'+encodeURIComponent(studioTable)+'/rows';
   await studioRequest(base+(studioEditId?'/'+studioEditId:''),{method:studioEditId?'PATCH':'POST',body:JSON.stringify({values:Object.fromEntries(Object.entries(studioValues).filter(([,v])=>v!==undefined))})});
   await refreshRows(studioTable);setStudioValues({});setStudioEditId(null);setMessage('Record saved.');
  }catch(e){setMessage((e as Error).message);}finally{setStudioBusy(false);}
 };
 const deleteStudioRow=async(id:string)=>{
  if(!studioProject||!studioTable||pendingDeleteId!==id)return;
  setStudioBusy(true);setMessage('');
  try{await studioRequest('/api/developer/projects/'+studioProject.id+'/tables/'+encodeURIComponent(studioTable)+'/rows/'+encodeURIComponent(id),{method:'DELETE'});await refreshRows(studioTable);setPendingDeleteId(null);setMessage('Record deleted.');}
  catch(e){setMessage((e as Error).message);}finally{setStudioBusy(false);}
 };
 const showStudioRows=async(table:string)=>{
  if(!studioProject)return;setPendingDeleteId(null);setStudioTable(table);setStudioEditId(null);setStudioValues({});setStudioSearch('');setStudioBusy(true);setMessage('');
  try{await refreshRows(table);}
  catch(e){setMessage((e as Error).message);}finally{setStudioBusy(false);}
 };
 const provisionDatabase=async(project:Project)=>{
  if(!window.confirm('Provision a private PostgreSQL schema for '+project.name+'? This creates infrastructure in Chipbase, but does not expose a public database API.'))return;
  setProvisioning(project.id);setMessage('');
  try{const r=await fetch('/api/developer/projects/'+encodeURIComponent(project.id)+'/provision',{method:'POST',credentials:'include'});
   const j=await r.json();if(!r.ok)throw new Error(j.error||'Provisioning failed');
   await refreshDeveloper();setMessage('Private database schema provisioned for '+project.name+'.');
  }catch(e){setMessage((e as Error).message);}finally{setProvisioning(null);}
 };
 useEffect(()=>{const url=new URL(window.location.href);const ticket=url.searchParams.get('github_ticket');if(ticket){url.searchParams.delete('github_ticket');window.history.replaceState({},'',url.pathname+url.search+url.hash);fetch('/api/developer/exchange',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({ticket})}).then(async r=>{if(!r.ok)throw new Error('GitHub login could not be completed');const m=await fetch('/api/developer/me',{credentials:'include'});if(m.ok){setDeveloper((await m.json()).user);refreshDeveloper().catch(e=>setMessage(e.message));}}).catch(e=>setMessage(e.message));return;}fetch('/api/developer/me',{credentials:'include'}).then(async r=>{if(r.ok){const j=await r.json();setDeveloper(j.user);refreshDeveloper().catch(e=>setMessage(e.message));}}).catch(()=>{});},[]);
 useEffect(()=>{fetch('/health').then(r=>r.json()).then(j=>setOnline(j.database==='connected')).catch(()=>setOnline(false));},[]);
 useEffect(()=>{if(!token){setVerified(false);return;}request('/api/admin/session',{method:'POST'},token).then(()=>{setVerified(true);refresh(token).catch(e=>setMessage(e.message));}).catch(()=>{setVerified(false);sessionStorage.removeItem('chipbase_admin_token');setToken('');setMessage('Session expired or invalid admin token');});},[token]);
 const login=async(e:React.FormEvent)=>{e.preventDefault();setBusy(true);setMessage('');try{await request('/api/admin/session',{method:'POST'},secret);sessionStorage.setItem('chipbase_admin_token',secret);setToken(secret);setSecret('');}catch(e){setMessage((e as Error).message);}finally{setBusy(false);}};
 const loadRepositories=async()=>{setRepoBusy(true);setMessage('');try{const r=await fetch('/api/developer/repositories',{credentials:'include'});const j=await r.json();if(!r.ok)throw new Error(j.error||'Could not load repositories');setRepositories(j.repositories||[]);}catch(e){setMessage((e as Error).message);}finally{setRepoBusy(false);}};
 const linkRepository=async(projectId:string,repositoryId:number)=>{setRepoBusy(true);setMessage('');try{const r=await fetch('/api/developer/projects/'+encodeURIComponent(projectId)+'/repository',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({repository_id:repositoryId})});const j=await r.json();if(!r.ok)throw new Error(j.error||'Link failed');await refreshDeveloper();setMessage('GitHub repository linked successfully.');}catch(e){setMessage((e as Error).message);}finally{setRepoBusy(false);}};
 const developerLogout=async()=>{await fetch('/api/developer/logout',{method:'POST',credentials:'include'});setDeveloper(null);setProjects([]);setCreating(false);};
 const logout=()=>{sessionStorage.removeItem('chipbase_admin_token');setToken('');setVerified(false);setProjects([]);};
 const create=async(e:React.FormEvent)=>{e.preventDefault();setBusy(true);setMessage('');try{if(developer&&!verified){const r=await fetch('/api/developer/projects',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,slug})});const j=await r.json();if(!r.ok)throw new Error(j.error||'Unable to create project');await refreshDeveloper();}else{await request('/api/projects',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,slug})});await refresh();}setCreating(false);setName('');setSlug('');setMessage('Project created. You can now provision its private database schema below.');}catch(e){setMessage((e as Error).message);}finally{setBusy(false);}};
 return <div className="shell"><aside><div className="brand"><div className="brandIcon"><Boxes size={24}/></div><div><strong>Chipbase</strong><small>DEVELOPER CLOUD</small></div></div><div className="workspace"><div className="avatar">C</div><div><b>Personal workspace</b><small>Admin preview</small></div></div><div className="navlabel">WORKSPACE</div>{[{name:'Overview',icon:FolderOpen},{name:'Projects',icon:Database},{name:'Infrastructure',icon:Server},{name:'Settings',icon:Settings}].map(i=><button key={i.name} className={'nav '+(page===i.name?'selected':'')} onClick={()=>setPage(i.name)}><i.icon size={18}/>{i.name}</button>)}<div className="foot"><ShieldCheck size={18}/> Admin preview <small>v0.8.0 • Record management</small></div></aside><main><header><span>Workspace <em>/</em> {page}</span><span className={'connect '+(online?'online':'')}>● {online?'Database connected':'Database offline'}</span></header><div className="content"><div className="overline">YOUR DEVELOPMENT ENVIRONMENT • PHASE 04</div><div className="hero"><div><h1>{page==='Overview'?'Your backend, under control.':page}</h1><p>Securely manage project metadata from your workspace.</p></div>{verified||developer?<div className="actions"><button className="newproject" onClick={()=>setCreating(true)}>+ New project</button><button className="secondary" onClick={verified?logout:developerLogout}><LogOut size={15}/> Sign out</button></div>:null}</div>{message&&<div role="alert" aria-live="assertive" style={{position:'fixed',top:20,right:20,zIndex:9999,width:'min(440px,calc(100vw - 32px))',padding:'16px 18px',borderRadius:12,background:'#32271c',border:'1px solid #b98548',color:'#fff1db',boxShadow:'0 12px 35px rgba(0,0,0,.45)',display:'flex',gap:14,alignItems:'flex-start',overflowWrap:'anywhere'}}><span style={{flex:1}}>{message}</span><button type="button" aria-label="Dismiss notification" onClick={()=>setMessage('')} style={{border:'none',background:'transparent',color:'inherit',cursor:'pointer',fontSize:22,lineHeight:1,padding:0}}>×</button></div>}{!verified&&developer?<div className="panel authpanel"><h2>Welcome, {developer.display_name||developer.login}</h2><p>Signed in as @{developer.login} using GitHub. Your projects are private to your developer account. You can create project records now; you can now link authorized GitHub repositories to your projects.</p><a className="github-login" href="https://github.com/apps/chipbase-cloud/installations/new" target="_blank" rel="noopener noreferrer">Install Chipbase GitHub App</a><p>Choose selected repositories on GitHub. After installation, click Refresh repositories below to link one to a project.</p></div>:null}{!verified&&!developer?<div className="panel authpanel"><h2><KeyRound size={18}/> Developer access</h2><p>Sign in with GitHub to create your Chipbase developer account.</p><a className="github-login" href="https://chipbase-api.onrender.com/auth/github/start">Sign in with GitHub</a><div className="auth-separator">OR ADMIN ACCESS</div><h2><Lock size={18}/> Admin sign in</h2><p>Enter the private CHIPBASE_ADMIN_TOKEN configured on the Render API. Never share it or put it in frontend environment variables.</p><form onSubmit={login}><input type="password" autoComplete="off" value={secret} onChange={e=>setSecret(e.target.value)} placeholder="Admin access token" required/><button className="newproject" disabled={busy}>{busy?'Checking…':'Unlock workspace'}</button></form></div>:<>{creating&&<div className="panel authpanel"><h2>Create project</h2><p>Creates a project record. You can then provision a private PostgreSQL schema; storage and public APIs are not yet available.</p><form onSubmit={create}><input value={name} maxLength={120} onChange={e=>{setName(e.target.value);setSlug(e.target.value.toLowerCase().trim().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,''));}} placeholder="Project name" required/><input value={slug} onChange={e=>setSlug(e.target.value)} pattern="[a-z][a-z0-9-]{2,47}" placeholder="project-slug" required/><button className="newproject" disabled={busy}>{busy?'Creating…':'Create project'}</button><button type="button" className="secondary" onClick={()=>setCreating(false)}>Cancel</button></form></div>}<div className="warning"><Lock size={17}/> Private PostgreSQL schema provisioning is available for GitHub developer projects. Dedicated databases, storage and public APIs are not yet enabled.</div><div className="stats"><div><small>PROJECTS</small><strong>{projects.length}</strong><span>Your project records</span></div><div><small>PLATFORM STATUS</small><strong>{online?'Online':'Setup needed'}</strong><span>{online?'PostgreSQL responding':'Check API health'}</span></div><div><small>RELEASE</small><strong>0.8.0</strong><span>Developer preview</span></div></div><div className="section"><h2>Platform modules</h2><p>Core services we're building for the Chipbase ecosystem.</p></div><div className="modules">{modules.map(m=><div className="module" key={m.name}><div className="modtop"><m.icon size={21}/><span>Planned</span></div><h3>{m.name}</h3><p>{m.description}</p></div>)}</div>{studioProject&&developer&&!verified?<div className="panel" style={{marginTop:24}}>
 <div style={{display:'flex',justifyContent:'space-between',gap:12,alignItems:'center'}}><h2>Database Studio — {studioProject.name}</h2><button className="secondary" onClick={()=>{setStudioProject(null);setStudioRows(null);}}>Close studio</button></div>
 <p>Manage tables in this project's private schema. Read-only row preview (up to 100 records). Public APIs are not enabled.</p>
 <h3>Tables</h3>
 {studioBusy?<p>Loading…</p>:null}
 {studioTables.length?studioTables.map(t=><div className="project" key={t.name} style={{display:'block'}}><strong>{t.name}</strong><small style={{display:'block'}}>{t.columns.map(c=>c.name+' ('+c.type+')').join(' • ')}</small><button type="button" className="secondary" onClick={()=>void showStudioRows(t.name)}>View rows</button></div>):<p>No tables yet.</p>}
 {studioRows!==null&&studioTable?<div style={{overflowX:'auto',marginTop:16}}>
 <h3>Records — {studioTable}</h3>
 <div style={{display:'flex',gap:8,flexWrap:'wrap',marginBottom:12}}>
 <input aria-label="Search records" placeholder="Search loaded records" value={studioSearch} onChange={e=>setStudioSearch(e.target.value)}/>
 <button className="secondary" type="button" disabled={studioBusy} onClick={()=>{setStudioBusy(true);refreshRows(studioTable).catch(e=>setMessage(e.message)).finally(()=>setStudioBusy(false));}}>Refresh records</button>
 <button className="secondary" type="button" onClick={()=>{setStudioEditId(null);setStudioValues({});}}>+ New record</button>
 </div>
 {studioRows.length?<table style={{width:'100%',borderCollapse:'collapse'}}><thead><tr>{Object.keys(studioRows[0]).map(k=><th key={k} style={{textAlign:'left',padding:8}}>{k}</th>)}<th>Actions</th></tr></thead><tbody>
 {studioRows.filter(r=>JSON.stringify(r).toLowerCase().includes(studioSearch.toLowerCase())).map((r,i)=><tr key={String(r.id)||i}>
 {Object.values(r).map((v,j)=><td key={j} style={{padding:8,borderTop:'1px solid #32505a',maxWidth:220,overflowWrap:'anywhere'}}>{v===null?'NULL':String(v)}</td>)}
 <td style={{whiteSpace:'nowrap'}}><button className="secondary" type="button" disabled={studioBusy} onClick={()=>{setStudioEditId(String(r.id));setStudioValues(Object.fromEntries(Object.entries(r).filter(([k])=>k!=='id').map(([k,v])=>[k,v])));}}>Edit</button>
 {pendingDeleteId===String(r.id)?<span style={{display:'inline-flex',gap:6,alignItems:'center',flexWrap:'wrap'}}><span style={{fontSize:13}}>Delete permanently?</span><button className="secondary" type="button" disabled={studioBusy} onClick={()=>void deleteStudioRow(String(r.id))}>{studioBusy?'Deleting…':'Confirm delete'}</button><button className="secondary" type="button" disabled={studioBusy} onClick={()=>setPendingDeleteId(null)}>Cancel</button></span>:<button className="secondary" type="button" disabled={studioBusy} onClick={()=>{setMessage('');setPendingDeleteId(String(r.id));}}>Delete</button>}</td></tr>)}</tbody></table>:<p>No rows in this table.</p>}
 <form onSubmit={saveStudioRow} style={{display:'grid',gap:10,marginTop:20}}>
 <h3>{studioEditId?'Edit record':'Add record'}</h3>
 {(studioTables.find(t=>t.name===studioTable)?.columns||[]).filter(c=>c.name!=='id').map(c=><label key={c.name} style={{display:'grid',gap:5}}>
 <span>{c.name} ({c.type})</span>
 {c.type==='boolean'?<select value={studioValues[c.name]===undefined?'':studioValues[c.name]===null?'null':String(studioValues[c.name])} onChange={e=>setStudioValues(v=>({...v,[c.name]:e.target.value===''?undefined:e.target.value==='null'?null:e.target.value==='true'}))}><option value="">Unchanged / omit</option><option value="true">true</option><option value="false">false</option><option value="null">NULL</option></select>:
 <input value={studioValues[c.name]===null?'':String(studioValues[c.name]??'')} placeholder={c.type==='timestamp with time zone'?'2026-11-13T12:00:00Z':c.name}
 onChange={e=>setStudioValues(v=>({...v,[c.name]:e.target.value===''?undefined:c.type==='integer'||c.type==='numeric'?Number(e.target.value):e.target.value}))}/>}
 </label>)}
 <div><button className="newproject" disabled={studioBusy}>{studioBusy?'Saving…':studioEditId?'Save changes':'Insert record'}</button>
 {studioEditId?<button type="button" className="secondary" onClick={()=>{setStudioEditId(null);setStudioValues({});}}>Cancel edit</button>:null}</div>
 </form></div>:null}
 <h3 style={{marginTop:20}}>Create table</h3>
 <form onSubmit={createStudioTable} style={{display:'grid',gap:12}}>
 <input value={studioName} onChange={e=>setStudioName(e.target.value)} pattern="[a-z][a-z0-9_]{0,47}" placeholder="Table name (e.g. subscribers)" required/>
 {studioColumns.map((c,i)=><div key={i} style={{display:'flex',gap:8,flexWrap:'wrap'}}>
 <input value={c.name} pattern="[a-z][a-z0-9_]{0,47}" onChange={e=>setStudioColumns(old=>old.map((v,j)=>i===j?{...v,name:e.target.value}:v))} placeholder="Column name" required/>
 <select value={c.type} onChange={e=>setStudioColumns(old=>old.map((v,j)=>i===j?{...v,type:e.target.value}:v))}>{['text','integer','boolean','numeric','timestamp','uuid'].map(t=><option key={t} value={t}>{t}</option>)}</select>
 {studioColumns.length>1?<button type="button" className="secondary" onClick={()=>setStudioColumns(old=>old.filter((_,j)=>j!==i))}>Remove</button>:null}</div>)}
 <div><button type="button" className="secondary" disabled={studioColumns.length>=20} onClick={()=>setStudioColumns(old=>[...old,{name:'',type:'text'}])}>+ Add column</button></div>
 <div><button className="newproject" disabled={studioBusy}>{studioBusy?'Working…':'Create table'}</button></div>
 </form>
 </div>:null}<div className="bottom"><div className="panel"><h2>Recent projects</h2>{developer&&!verified?<button className="secondary" onClick={loadRepositories} disabled={repoBusy}>{repoBusy?'Loading repositories…':'Refresh GitHub repositories'}</button>:null}{projects.length?projects.map(p=><div key={p.id} className="project"><Database size={18}/><span>{p.name}<small>{p.slug}</small>{p.github_repository_full_name?<small>Linked: {p.github_repository_full_name}</small>:developer&&!verified?<span><select aria-label={'Link GitHub repository to '+p.name} defaultValue="" disabled={repoBusy||!repositories.length} onChange={e=>{if(e.target.value)void linkRepository(p.id,Number(e.target.value));}}><option value="">Select authorized repository</option>{repositories.map(r=><option key={r.id} value={r.id}>{r.full_name}</option>)}</select></span>:null}
 {developer&&!verified?<span style={{display:'block',marginTop:12}}>
  <small>Database: {databaseStatuses[p.id]?.status==='ready'?'Ready':databaseStatuses[p.id]?.status==='not_provisioned'?'Not provisioned':'Checking / unavailable'}</small>
  {databaseStatuses[p.id]?.schema_name?<small style={{overflowWrap:'anywhere'}}>Schema: {databaseStatuses[p.id].schema_name}</small>:null}
  {databaseStatuses[p.id]?.provisioned_at?<small>Provisioned: {new Date(databaseStatuses[p.id].provisioned_at!).toLocaleString()}</small>:null}
  {databaseStatuses[p.id]?.status==='ready'?<button type="button" className="secondary" style={{marginTop:8}} onClick={()=>void openStudio(p)}>Open database studio</button>:null}
  {databaseStatuses[p.id]?.status==='not_provisioned'?<button type="button" className="secondary" style={{marginTop:8}} disabled={provisioning!==null} onClick={()=>void provisionDatabase(p)}>{provisioning===p.id?'Provisioning…':'Provision database'}</button>:null}
 </span>:null}</span><small>{p.status}</small></div>):<div className="empty"><FolderOpen size={30}/><b>No projects yet</b><p>Create your first project metadata record.</p></div>}</div><div className="panel"><h2>Infrastructure</h2><p>API hosted on Render; dashboard hosted on Vercel.</p><code>/health</code><code>/api/projects • protected</code><div className="tip"><ShieldCheck size={17}/> Never expose the admin token in client build configuration.</div></div></div></>}</div></main></div>;
}
