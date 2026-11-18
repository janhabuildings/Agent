import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {ScheduleStore} from '../server/schedules/store.js';
import {scheduleKey} from '../server/schedules/crypto.js';
import {validateSchedule} from '../server/schedules/plan.js';
import {schedulerTick} from '../server/schedules/worker.js';
function postgresPool(db){const query=(sql,params)=>!params&&sql.includes('CREATE TABLE')?db.exec(sql).then(()=>({rows:[]})):db.query(sql,params);return {query,connect:async()=>({query,release(){}}),end:()=>db.close()};}
const alice={email:'alice@example.com',imap:{email:'alice@example.com',password:'alice-password'}};const bob={email:'bob@example.com',imap:{email:'bob@example.com',password:'bob-password'}};
const plan=()=>validateSchedule({title:'Inbox report',instructions:'Summarize recent email',cron:'0 8 * * 1-5',timezone:'America/New_York',sources:['email']});
test('real PostgreSQL schema: encrypted account isolation, due runs, history, pause, manual run and revocation',{timeout:30000},async()=>{
 const db=new PGlite();const pool=postgresPool(db);const key=scheduleKey('secure-test-key-'.repeat(4));const store=new ScheduleStore({pool,key});
 try{
  const created=await store.create(alice,plan(),{email:{provider:'imap',email:alice.email,imap:alice.imap}});
  assert.equal((await store.list(alice)).length,1);assert.equal((await store.list(bob)).length,0);assert.equal(await store.getOwned(bob,created.id),null);assert.equal(await store.remove(bob,created.id),false);
  const raw=(await db.query('SELECT payload FROM agent_schedule_connections')).rows[0].payload;assert.ok(!raw.includes('alice-password'));
  // A fresh store using the same database and encryption key restores the saved task.
  const reopened=new ScheduleStore({pool,key});assert.equal((await reopened.list(alice))[0].title,'Inbox report');const wrong=new ScheduleStore({pool,key:scheduleKey('wrong-test-key-'.repeat(4))});await assert.rejects(()=>wrong.init(),/encryption key does not match/);
  await store.update(alice,created.id,{enabled:false});await store.update(alice,created.id,{runNow:true});
  let calls=0;const outcome=await schedulerTick(store,{run:async(task,connections)=>{calls++;assert.equal(connections.email.imap.password,'alice-password');return {answer:'Report from saved connection',sources:[]};}});assert.equal(outcome.processed,1);assert.equal(calls,1);assert.equal((await store.list(alice))[0].enabled,false);
  const runs=await store.runs(alice,created.id);assert.equal(runs.length,1);assert.equal(runs[0].state,'succeeded');assert.equal(runs[0].answer,'Report from saved connection');assert.equal(await store.runs(bob,created.id),null);
  assert.equal((await schedulerTick(store,{run:async()=>{throw Error('Should not run twice');}})).processed,0);
  await store.update(alice,created.id,{enabled:true});await store.revoke(alice,'email');assert.equal((await store.list(alice))[0].enabled,false);assert.equal((await db.query('SELECT * FROM agent_schedule_connections')).rows.length,0);
  assert.equal(await store.remove(alice,created.id),true);assert.equal((await db.query('SELECT * FROM agent_schedule_runs')).rows.length,0);
 }finally{await store.close();}
});
test('failed and abandoned runs recover without duplicate logical reports and schedule edits preserve paused state',{timeout:30000},async()=>{
 const db=new PGlite();const pool=postgresPool(db);const store=new ScheduleStore({pool,key:scheduleKey('second-test-key-'.repeat(4))});
 try{
  const item=await store.create(alice,plan(),{email:{provider:'imap',email:alice.email,imap:alice.imap}},{enabled:false});
  await store.update(alice,item.id,{runNow:true});const due=(await db.query('SELECT next_run FROM agent_schedules WHERE id=$1',[item.id])).rows[0].next_run;
  const oldId='11111111-1111-4111-8111-111111111111';await db.query("INSERT INTO agent_schedule_runs(id,schedule_id,due_at,state) VALUES($1,$2,$3,'running')",[oldId,item.id,due]);await db.query("UPDATE agent_schedules SET lease_until=now()-interval '1 minute' WHERE id=$1",[item.id]);
  const result=await schedulerTick(store,{run:async()=>{const e=Error('private provider details');e.status=401;throw e;}});assert.equal(result.processed,1);const runs=await store.runs(alice,item.id);assert.equal(runs.length,1);assert.equal(runs[0].id,oldId);assert.equal(runs[0].state,'failed');assert.ok(!runs[0].error.includes('private provider details'));
  const updated=await store.update(alice,item.id,{plan:validateSchedule({...plan(),title:'Edited',cron:'0 9 * * 1-5'})});assert.equal(updated.enabled,false);assert.equal(updated.title,'Edited');
 }finally{await store.close();}
});
test('interactive CRM and background runs share rotated refresh tokens through the encrypted vault',{timeout:30000},async()=>{
 const db=new PGlite();const pool=postgresPool(db);const store=new ScheduleStore({pool,key:scheduleKey('crm-vault-test-'.repeat(4))});const session={crm:{userId:'crm-user',accessToken:'access-a',refreshToken:'refresh-a',email:'crm@example.com'}};
 try{
  const crmPlan=validateSchedule({...plan(),sources:['crm']});const item=await store.create(session,crmPlan,{crm:{...session.crm}},{enabled:false});
  await store.withCrm(session,async connection=>{assert.equal(connection.refreshToken,'refresh-a');connection.refreshToken='refresh-b';return {};});
  await store.update(session,item.id,{runNow:true});await schedulerTick(store,{run:async(task,connections)=>{assert.equal(connections.crm.refreshToken,'refresh-b');connections.crm.refreshToken='refresh-c';return {answer:'CRM report'};}});
  await store.withCrm(session,async connection=>{assert.equal(connection.refreshToken,'refresh-c');return {};});assert.equal(session.crm.refreshToken,'refresh-c');
 }finally{await store.close();}
});
test('schedules and sealed grants survive closing and reopening the database',{timeout:30000},async()=>{
 const {mkdtemp,rm}=await import('node:fs/promises');const {tmpdir}=await import('node:os');const {join}=await import('node:path');const directory=await mkdtemp(join(tmpdir(),'agent-schedules-test-'));const key=scheduleKey('restart-key-'.repeat(4));let store;
 try{
  store=new ScheduleStore({pool:postgresPool(new PGlite(directory)),key});await store.create(alice,plan(),{email:{provider:'imap',email:alice.email,imap:alice.imap}},{enabled:false});await store.close();store=null;
  store=new ScheduleStore({pool:postgresPool(new PGlite(directory)),key});const items=await store.list(alice);assert.equal(items.length,1);assert.equal(items[0].title,'Inbox report');await store.update(alice,items[0].id,{runNow:true});await schedulerTick(store,{run:async(task,connections)=>{assert.equal(connections.email.imap.password,'alice-password');return {answer:'Restored connection works'};}});assert.equal((await store.runs(alice,items[0].id))[0].answer,'Restored connection works');
 }finally{if(store)await store.close();await rm(directory,{recursive:true,force:true});}
});
