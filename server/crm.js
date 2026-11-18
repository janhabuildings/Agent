import {readFileSync} from 'node:fs';
const defaults=JSON.parse(readFileSync(new URL('./crm-public.json',import.meta.url),'utf8'));
export function crmConfig(env=process.env){
 const url=(env.CRM_SUPABASE_URL||defaults.url).replace(/\/$/,'');const key=(env.CRM_SUPABASE_PUBLISHABLE_KEY||defaults.publishableKey).trim();
 if(!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(url))throw Error('CRM requires a Supabase HTTPS project URL');
 let publicKey=key.startsWith('sb_publishable_');
 if(!publicKey)try{publicKey=JSON.parse(Buffer.from(key.split('.')[1],'base64url')).role==='anon';}catch{}
 if(!publicKey)throw Error('CRM requires a public/anon key, never a service-role key');
 return {url,key};
}
export const CRM_TABLES={
 projects:{label:'Projects',fields:'id,project_type,address,borough,status,description,client_id,updated_at,clients(name,company)',search:['project_type','address','description'],order:'updated_at.desc',path:'projects'},
 clients:{label:'Clients',fields:'id,name,company,email,phone,client_type,address,notes,updated_at',search:['name','company','email'],order:'updated_at.desc',path:'clients'},
 jobs:{label:'Jobs',fields:'id,title,status,description,project_id,updated_at,projects(address,project_type)',search:['title','description'],order:'updated_at.desc',path:'jobs'},
 job_tasks:{label:'Tasks',fields:'id,title,status,priority,due_date,start_date,progress_pct,description,updated_at,job_items(job_id)',search:['title','description'],order:'due_date.asc.nullslast',path:'jobs'},
 proposals:{label:'Proposals',fields:'id,number,title,status,client_id,project_id,sent_at,signed_at,updated_at',search:['number','title'],order:'updated_at.desc',path:'proposals'},
 invoices:{label:'Invoices',fields:'id,number,title,status,total,amount_paid,due_date,client_id,updated_at',search:['number','title'],order:'updated_at.desc',path:'invoices',admin:true},
};
async function request(path,{token,method='GET',body,prefer}={},fetcher=fetch){
 const {url,key}=crmConfig();
 const response=await fetcher(url+path,{method,headers:{apikey:key,...(token?{Authorization:`Bearer ${token}`} : {}),'Content-Type':'application/json',...(prefer?{Prefer:prefer}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(20000),redirect:'error'});
 if(!response.ok){const error=Error('CRM request failed');error.status=response.status;error.service='crm';throw error;}
 if(response.status===204)return {data:null,response};
 const chunks=[];let bytes=0;if(response.body)for await(const chunk of response.body){bytes+=chunk.length;if(bytes>1024*1024)throw Error('CRM response limit');chunks.push(chunk);}
 return {data:JSON.parse(Buffer.concat(chunks).toString()||'null'),response};
}
export async function signInCrm(email,password,fetcher){
 const {data}=await request('/auth/v1/token?grant_type=password',{method:'POST',body:{email,password}},fetcher);
 if(!data?.access_token||!data?.user?.id)throw Error('Invalid CRM sign-in response');
 return {accessToken:data.access_token,refreshToken:data.refresh_token,userId:data.user.id,email:data.user.email||email,expiresAt:Date.now()+Number(data.expires_in||3600)*1000};
}
export async function crmToken(connection,fetcher){
 if(Date.now()<connection.expiresAt-30000)return connection.accessToken;
 if(!connection.refreshToken){const e=Error('CRM sign-in expired');e.status=401;throw e;}
 if(!connection.refreshing)connection.refreshing=(async()=>{
  const {data}=await request('/auth/v1/token?grant_type=refresh_token',{method:'POST',body:{refresh_token:connection.refreshToken}},fetcher);
  if(!data?.access_token)throw Error('CRM refresh failed');connection.accessToken=data.access_token;connection.refreshToken=data.refresh_token;connection.expiresAt=Date.now()+Number(data.expires_in||3600)*1000;
 })().finally(()=>{delete connection.refreshing;});
 await connection.refreshing;return connection.accessToken;
}
export async function disconnectCrm(connection,fetcher){try{await request('/auth/v1/logout?scope=local',{method:'POST',token:connection.accessToken},fetcher);}catch{}}
export function safeCrmPlan(plan){
 const table=Object.hasOwn(CRM_TABLES,plan?.table)?plan.table:'projects';
 const search=typeof plan?.search==='string'?plan.search.replace(/[^\p{L}\p{N}\s.-]/gu,' ').trim().replace(/\s+/g,' ').slice(0,80):'';
 return {table,search,dateMode:['upcoming','overdue'].includes(plan?.dateMode)?plan.dateMode:'all'};
}
export async function readCrm(connection,plan,fetcher){
 const {table,search,dateMode}=safeCrmPlan(plan);const schema=CRM_TABLES[table];const token=await crmToken(connection,fetcher);
 if(schema.admin){const {data}=await request('/rest/v1/rpc/is_admin',{method:'POST',token,body:{_user_id:connection.userId}},fetcher);if(data!==true){const error=Error('Invoice access requires CRM administrator permission');error.status=403;throw error;}}
 const query=new URLSearchParams({select:schema.fields,order:schema.order,limit:'50'});
 if(['job_tasks','invoices'].includes(table)&&dateMode!=='all'){const today=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());query.set('due_date',`${dateMode==='upcoming'?'gte':'lt'}.${today}`);}
 if(search)query.set('or',`(${schema.search.map(field=>`${field}.ilike.*${search}*`).join(',')})`);
 const {data,response}=await request(`/rest/v1/${table}?${query}`,{token,prefer:'count=exact'},fetcher);
 if(!Array.isArray(data))throw Error('Invalid CRM records');
 const totalString=response.headers.get('content-range')?.split('/')[1];const total=totalString&&totalString!=='*'?Number(totalString):null;
 let budget=45000;
 const records=[];for(const raw of data){const row={};for(const [key,value] of Object.entries(raw))row[key]=typeof value==='string'?value.slice(0,3000):value;const size=JSON.stringify(row).length;if(size>budget)break;budget-=size;records.push({id:`crm-${table}-${row.id}`,record:row});}
 const sources=records.map(({id,record})=>({id,kind:'crm',subject:record.title||record.address||record.name||record.number||schema.label,from:`JBI CRM · ${schema.label}`,date:record.updated_at||'',url:`https://crm.jbius.com/${schema.path}${table==='job_tasks'?(record.job_items?.job_id?'/'+record.job_items.job_id:''):'/'+record.id}`,excerpt:JSON.stringify(record,null,2)}));
 return {table,label:schema.label,search,records,sources,total,limited:total===null||total>records.length};
}
export function crmError(error){
 if(error.status===400||error.status===401)return {status:401,error:'JBI Platform sign-in failed or expired. Check your CRM email and password and reconnect.'};
 if(error.status===403)return {status:403,error:'Your JBI Platform account does not have permission to read these records. Invoice access requires CRM administrator permission.'};
 return {status:502,error:'Could not reach JBI CRM or read its records. Please retry; check the CRM connection if it continues.'};
}
