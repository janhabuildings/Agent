import {randomUUID} from 'node:crypto';
import {seal,unseal} from './crypto.js';
import {nextRun} from './plan.js';
import {runScheduledTask,scheduledFailure} from './runner.js';
export async function schedulerTick(store,{run=runScheduledTask,maxJobs=10,now=()=>new Date()}={}){
 await store.init();const client=await store.pool.connect();let locked=false,processed=0,ownerLocked=null;
 try{
  // One active background reader across all worker replicas. No open transaction during API calls.
  const lock=await client.query('SELECT pg_try_advisory_lock(178903, 1) AS locked');locked=lock.rows[0].locked;if(!locked)return {processed:0,busy:true};
  await client.query('INSERT INTO agent_scheduler_heartbeat(id,last_seen) VALUES(1,$1) ON CONFLICT(id) DO UPDATE SET last_seen=excluded.last_seen',[now()]);
  while(processed<maxJobs){
   await client.query('BEGIN');
   const selected=await client.query('SELECT * FROM agent_schedules WHERE (enabled=true OR run_requested=true) AND next_run<=$1 AND (lease_until IS NULL OR lease_until<$1) ORDER BY next_run FOR UPDATE SKIP LOCKED LIMIT 1',[now()]);
   const row=selected.rows[0];if(!row){await client.query('COMMIT');break;}
   await client.query('UPDATE agent_schedules SET lease_until=$2,run_requested=false WHERE id=$1',[row.id,new Date(now().getTime()+15*60000)]);
   const inserted=await client.query("INSERT INTO agent_schedule_runs(id,schedule_id,due_at,state) VALUES($1,$2,$3,'running') ON CONFLICT(schedule_id,due_at) DO UPDATE SET state='running',started_at=now(),finished_at=NULL,payload=NULL RETURNING id",[randomUUID(),row.id,row.next_run]);
   const runId=inserted.rows[0].id;await client.query('COMMIT');
   await client.query('SELECT pg_advisory_lock(hashtext($1),178904)',[row.owner_id]);ownerLocked=row.owner_id;
   const task=store.decrypt(row);let connections={},version=null,state='succeeded',result;
   const pulse=setInterval(()=>{void client.query('UPDATE agent_schedules SET lease_until=$2,run_requested=false WHERE id=$1',[row.id,new Date(Date.now()+15*60000)]).catch(()=>{});void client.query('UPDATE agent_scheduler_heartbeat SET last_seen=now() WHERE id=1').catch(()=>{});},30000);pulse.unref();
   try{
    const saved=await client.query('SELECT * FROM agent_schedule_connections WHERE owner_id=$1',[row.owner_id]);if(!saved.rows[0])throw Error('Missing saved connections');version=saved.rows[0].version;connections=unseal(saved.rows[0].payload,store.key,`${row.owner_id}:connections`);
    if(connections.crm)connections.crm.onRefresh=async()=>{const update=await client.query('UPDATE agent_schedule_connections SET payload=$2,version=version+1 WHERE owner_id=$1 AND version=$3 RETURNING version',[row.owner_id,seal(connections,store.key,`${row.owner_id}:connections`),version]);if(update.rows[0])version=update.rows[0].version;};
    result=await run(task,connections);
   }catch(error){state='failed';result={error:scheduledFailure(error)};}finally{clearInterval(pulse);}
   delete connections.crm?.onRefresh;delete connections.crm?.refreshing;const finished=now();await client.query('BEGIN');
   if(version!==null)await client.query('UPDATE agent_schedule_connections SET payload=$2,version=version+1 WHERE owner_id=$1 AND version=$3',[row.owner_id,seal(connections,store.key,`${row.owner_id}:connections`),version]);
   await client.query('UPDATE agent_schedule_runs SET state=$2,finished_at=$3,payload=$4 WHERE id=$1',[runId,state,finished,seal(result,store.key,`${row.owner_id}:run:${runId}`)]);
   await client.query('UPDATE agent_schedules SET last_run=$2,last_state=$3,next_run=$4,lease_until=NULL WHERE id=$1',[row.id,finished,state,nextRun(task,finished)]);
   // Keep a bounded run history; all report contents remain encrypted.
   await client.query('DELETE FROM agent_schedule_runs WHERE schedule_id=$1 AND id NOT IN (SELECT id FROM agent_schedule_runs WHERE schedule_id=$1 ORDER BY started_at DESC LIMIT 30)',[row.id]);
   await client.query('COMMIT');await client.query('SELECT pg_advisory_unlock(hashtext($1),178904)',[row.owner_id]);ownerLocked=null;processed++;
  }
  return {processed,busy:false};
 }catch(error){await client.query('ROLLBACK').catch(()=>{});throw error;}
 finally{if(ownerLocked)await client.query('SELECT pg_advisory_unlock(hashtext($1),178904)',[ownerLocked]).catch(()=>{});if(locked)await client.query('SELECT pg_advisory_unlock(178903, 1)').catch(()=>{});client.release();}
}
