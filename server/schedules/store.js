import {Pool} from 'pg';
import {databaseConnectionString} from './diagnostics.js';
import {randomUUID,createHash} from 'node:crypto';
import {scheduleKey,seal,unseal,ownerKey} from './crypto.js';
import {nextRun,sessionIdentities} from './plan.js';
function userError(message){const error=Error(message);error.schedulePublic=message;return error;}
const schema=`
CREATE TABLE IF NOT EXISTS agent_schedule_config(id integer PRIMARY KEY CHECK(id=1),key_id text NOT NULL);
CREATE TABLE IF NOT EXISTS agent_schedules (id uuid PRIMARY KEY,owner_id text NOT NULL,payload text NOT NULL,enabled boolean NOT NULL DEFAULT true,run_requested boolean NOT NULL DEFAULT false,next_run timestamptz NOT NULL,last_run timestamptz,lease_until timestamptz,last_state text,created_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE agent_schedules ADD COLUMN IF NOT EXISTS run_requested boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS agent_schedules_due ON agent_schedules(enabled,next_run);
CREATE INDEX IF NOT EXISTS agent_schedules_owner ON agent_schedules(owner_id);
CREATE TABLE IF NOT EXISTS agent_schedule_connections (owner_id text PRIMARY KEY,payload text NOT NULL,version integer NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS agent_schedule_runs (id uuid PRIMARY KEY,schedule_id uuid NOT NULL REFERENCES agent_schedules(id) ON DELETE CASCADE,due_at timestamptz NOT NULL,state text NOT NULL,started_at timestamptz NOT NULL DEFAULT now(),finished_at timestamptz,payload text,UNIQUE(schedule_id,due_at));
CREATE TABLE IF NOT EXISTS agent_scheduler_heartbeat (id integer PRIMARY KEY CHECK(id=1),last_seen timestamptz NOT NULL);
`;
export function schedulingConfigured(env=process.env){try{return Boolean(env.DATABASE_URL&&scheduleKey(env.SCHEDULE_ENCRYPTION_KEY));}catch{return false;}}
export class ScheduleStore{
 constructor({pool,key}={}){this.pool=pool||new Pool({connectionString:databaseConnectionString(process.env.DATABASE_URL),max:4,connectionTimeoutMillis:10000});this.key=key||scheduleKey();this.ready=null;}
 async init(){
  this.ready ||= (async()=>{const client=await this.pool.connect();try{await client.query('BEGIN');await client.query('SELECT pg_advisory_xact_lock(178903,0)');await client.query(schema);const keyId=createHash('sha256').update(this.key).digest('hex');await client.query('INSERT INTO agent_schedule_config(id,key_id) VALUES(1,$1) ON CONFLICT(id) DO NOTHING',[keyId]);const saved=await client.query('SELECT key_id FROM agent_schedule_config WHERE id=1');if(saved.rows[0].key_id!==keyId)throw userError('The scheduling encryption key does not match this database. Restore the original SCHEDULE_ENCRYPTION_KEY on both web and worker.');await client.query('COMMIT');}catch(error){await client.query('ROLLBACK').catch(()=>{});throw error;}finally{client.release();}})().catch(error=>{this.ready=null;error.scheduleStage ||= 'database_init';throw error;});await this.ready;
 }
 owners(session){return sessionIdentities(session).map(id=>ownerKey(id,this.key));}
 primaryOwner(session,plan){const identity=plan.sources.includes('crm')?'crm:'+session.crm?.userId:'email:'+session.email?.toLowerCase();if(identity.endsWith('undefined'))throw Error('Reconnect the required data source.');return ownerKey(identity,this.key);}
 decrypt(row){const plan=unseal(row.payload,this.key,`${row.owner_id}:schedule:${row.id}`);return {...plan,id:row.id,enabled:row.enabled,nextRun:new Date(row.next_run).toISOString(),lastRun:row.last_run?new Date(row.last_run).toISOString():null,lastState:row.last_state||null,createdAt:new Date(row.created_at).toISOString()};}
 async list(session){await this.init();const rows=await this.pool.query('SELECT * FROM agent_schedules WHERE owner_id=ANY($1::text[]) ORDER BY created_at DESC',[this.owners(session)]);return rows.rows.map(row=>this.decrypt(row));}
 async heartbeat(){await this.init();const result=await this.pool.query('SELECT last_seen FROM agent_scheduler_heartbeat WHERE id=1');return result.rows[0]?.last_seen||null;}
 async create(session,plan,connections,{enabled=true}={}){
  await this.init();const owner=this.primaryOwner(session,plan);const id=randomUUID();const client=await this.pool.connect();
  try{await client.query('BEGIN');await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[owner]);const count=await client.query('SELECT count(*)::integer AS n FROM agent_schedules WHERE owner_id=$1',[owner]);if(count.rows[0].n>=25)throw userError('Limit reached: at most 25 schedules per account.');
   await this.saveConnections(client,owner,connections);
   const result=await client.query('INSERT INTO agent_schedules(id,owner_id,payload,next_run,enabled) VALUES($1,$2,$3,$4,$5) RETURNING *',[id,owner,seal(plan,this.key,`${owner}:schedule:${id}`),nextRun(plan),enabled]);await client.query('COMMIT');return this.decrypt(result.rows[0]);
  }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
 }
 async saveConnections(client,owner,connections){
  // Serialize changes to one account's vault, including concurrent activations.
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[owner]);
  const existing=await client.query('SELECT payload FROM agent_schedule_connections WHERE owner_id=$1 FOR UPDATE',[owner]);const previous=existing.rows[0]?unseal(existing.rows[0].payload,this.key,`${owner}:connections`):{};
  for(const type of Object.keys(connections)){
   if(previous[type] && (type==='email'?previous[type].email!==connections[type].email:previous[type].userId!==connections[type].userId))throw userError('Saved schedules use a different account. Reconnect the original account or delete those schedules first.');
  }
  await client.query('INSERT INTO agent_schedule_connections(owner_id,payload) VALUES($1,$2) ON CONFLICT(owner_id) DO UPDATE SET payload=excluded.payload,version=agent_schedule_connections.version+1',[owner,seal({...previous,...connections},this.key,`${owner}:connections`)]);
 }
 async getOwned(session,id){await this.init();const result=await this.pool.query('SELECT * FROM agent_schedules WHERE id=$1 AND owner_id=ANY($2::text[])',[id,this.owners(session)]);return result.rows[0]||null;}
 async update(session,id,{enabled,runNow=false,plan,connections}={}){
  const original=await this.getOwned(session,id);if(!original)return null;const client=await this.pool.connect();
  try{await client.query('BEGIN');await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[original.owner_id]);
   const latest=await client.query('SELECT * FROM agent_schedules WHERE id=$1 AND owner_id=ANY($2::text[]) FOR UPDATE',[id,this.owners(session)]);const row=latest.rows[0];if(!row){await client.query('ROLLBACK');return null;}
   if((plan||runNow)&&row.lease_until&&new Date(row.lease_until)>new Date())throw userError('Task is already running. Wait for it to finish before editing or running again.');
   const next=plan||this.decrypt(row);if(connections)await this.saveConnections(client,row.owner_id,connections);
   const due=runNow?new Date():row.run_requested&&enabled!==false&&!plan?row.next_run:plan||enabled===true?nextRun(next):row.next_run;
   const result=await client.query('UPDATE agent_schedules SET payload=$2,enabled=$3,next_run=$4,run_requested=$5 WHERE id=$1 RETURNING *',[id,seal(next,this.key,`${row.owner_id}:schedule:${id}`),typeof enabled==='boolean'?enabled:row.enabled,due,runNow?true:enabled===false?false:Boolean(row.run_requested)]);await client.query('COMMIT');return this.decrypt(result.rows[0]);
  }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
 }
 async remove(session,id){
  const row=await this.getOwned(session,id);if(!row)return false;const client=await this.pool.connect();
  try{await client.query('BEGIN');await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[row.owner_id]);await client.query('DELETE FROM agent_schedules WHERE id=$1 AND owner_id=$2',[id,row.owner_id]);const remaining=await client.query('SELECT id FROM agent_schedules WHERE owner_id=$1 LIMIT 1',[row.owner_id]);if(!remaining.rows.length){const vault=await client.query('SELECT payload FROM agent_schedule_connections WHERE owner_id=$1',[row.owner_id]);if(vault.rows[0]&&session.crm){const saved=unseal(vault.rows[0].payload,this.key,`${row.owner_id}:connections`);if(saved.crm?.userId===session.crm.userId)session.crm=saved.crm;}await client.query('DELETE FROM agent_schedule_connections WHERE owner_id=$1',[row.owner_id]);}await client.query('COMMIT');return true;}catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
 }
 async runs(session,id){const row=await this.getOwned(session,id);if(!row)return null;const result=await this.pool.query('SELECT * FROM agent_schedule_runs WHERE schedule_id=$1 ORDER BY started_at DESC LIMIT 30',[id]);return result.rows.map(run=>({id:run.id,state:run.state,startedAt:run.started_at,finishedAt:run.finished_at,...(run.payload?unseal(run.payload,this.key,`${row.owner_id}:run:${run.id}`):{})}));}
 async withCrm(session,action){
  if(!session?.crm)return action(session?.crm);
  await this.init();const owner=ownerKey('crm:'+session.crm.userId,this.key);const client=await this.pool.connect();let locked=false;
  try{
   const initial=await client.query('SELECT owner_id FROM agent_schedule_connections WHERE owner_id=$1',[owner]);if(!initial.rows.length)return await action(session.crm);
   await client.query('SELECT pg_advisory_lock(hashtext($1),178904)',[owner]);locked=true;
   const saved=await client.query('SELECT * FROM agent_schedule_connections WHERE owner_id=$1',[owner]);if(!saved.rows.length)return await action(session.crm);
   const connections=unseal(saved.rows[0].payload,this.key,`${owner}:connections`);if(!connections.crm)return await action(session.crm);
   let version=saved.rows[0].version;
   connections.crm.onRefresh=async()=>{const result=await client.query('UPDATE agent_schedule_connections SET payload=$2,version=version+1 WHERE owner_id=$1 AND version=$3 RETURNING version',[owner,seal(connections,this.key,`${owner}:connections`),version]);if(result.rows[0])version=result.rows[0].version;};
   try{const result=await action(connections.crm);session.crm=connections.crm;return result;}
   finally{delete connections.crm.onRefresh;delete connections.crm.refreshing;await client.query('UPDATE agent_schedule_connections SET payload=$2,version=version+1 WHERE owner_id=$1 AND version=$3',[owner,seal(connections,this.key,`${owner}:connections`),version]);}
  }finally{if(locked)await client.query('SELECT pg_advisory_unlock(hashtext($1),178904)',[owner]);client.release();}
 }
 async revoke(session,source){
  if(!sessionIdentities(session).length)return;
  await this.init();const owners=this.owners(session);const client=await this.pool.connect();
  try{await client.query('BEGIN');for(const owner of owners){
   await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[owner]);const vault=await client.query('SELECT * FROM agent_schedule_connections WHERE owner_id=$1 FOR UPDATE',[owner]);if(!vault.rows[0])continue;const connections=unseal(vault.rows[0].payload,this.key,`${owner}:connections`);delete connections[source];
   if(Object.keys(connections).length)await client.query('UPDATE agent_schedule_connections SET payload=$2,version=version+1 WHERE owner_id=$1',[owner,seal(connections,this.key,`${owner}:connections`)]);else await client.query('DELETE FROM agent_schedule_connections WHERE owner_id=$1',[owner]);
   const rows=await client.query('SELECT * FROM agent_schedules WHERE owner_id=$1',[owner]);for(const row of rows.rows)if(this.decrypt(row).sources.includes(source))await client.query('UPDATE agent_schedules SET enabled=false,run_requested=false WHERE id=$1',[row.id]);
  }await client.query('COMMIT');}catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
 }
 async close(){await this.pool.end();}
}
