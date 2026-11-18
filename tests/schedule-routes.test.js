import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {PGlite} from '@electric-sql/pglite';
import {mountScheduleRoutes} from '../server/schedules/routes.js';
import {ScheduleStore} from '../server/schedules/store.js';
import {scheduleKey} from '../server/schedules/crypto.js';
import {schedulerTick} from '../server/schedules/worker.js';
import {once} from 'node:events';
test('schedule API requires owner identity, reviewed draft and consent; paused activation, run-now and private history work',{timeout:30000},async()=>{
 const db=new PGlite();const query=(sql,params)=>!params&&sql.includes('CREATE TABLE')?db.exec(sql).then(()=>({rows:[]})):db.query(sql,params);const pool={query,connect:async()=>({query,release(){}}),end:()=>db.close()};const store=new ScheduleStore({pool,key:scheduleKey('api-test-secret-'.repeat(4))});
 const sessions={alice:{email:'alice@example.com',imap:{email:'alice@example.com',password:'private-mailbox-password'}},bob:{email:'bob@example.com',imap:{email:'bob@example.com',password:'other-private-password'}}};
 const app=express();app.use(express.json());app.use((req,res,next)=>{req.session=sessions[req.headers['x-test-account']];next();});mountScheduleRoutes(app,{storeProvider:()=>store,ai:async messages=>messages[0].content.startsWith('Translate')?JSON.stringify({supported:true,cron:'0 10 * * 1-5',timezone:'America/New_York'}):JSON.stringify({title:'Morning email',instructions:'Summarize my urgent emails',sources:['email'],cron:'0 8 * * 1-5',timezone:'America/New_York',supported:true,explanation:'Weekday morning inbox report'})});
 const server=app.listen(0,'127.0.0.1');await once(server,'listening');const base=`http://127.0.0.1:${server.address().port}/api/schedules`;
 const request=async(path='',method='GET',body,account='alice')=>{const response=await fetch(base+path,{method,headers:{'Content-Type':'application/json',...(account?{'x-test-account':account}:{})},...(body?{body:JSON.stringify(body)}:{})});return {status:response.status,data:await response.json()};};
 try{
  assert.equal((await request('','GET',undefined,null)).status,401);
  const preview=await request('/preview','POST',{description:'Every weekday at 8 AM summarize urgent email',timezone:'America/New_York'});assert.equal(preview.status,200);const draftId=preview.data.draftId;
  assert.equal((await request('','POST',{draftId,consent:true,enabled:false},'bob')).status,400);
  assert.equal((await request('','POST',{draftId,enabled:false})).status,400);
  assert.equal((await request('','POST',{draftId,consent:true})).status,409);
  const created=await request('','POST',{draftId,consent:true,enabled:false});assert.equal(created.status,201);const id=created.data.schedule.id;assert.equal(created.data.schedule.enabled,false);assert.ok(!JSON.stringify(created.data).includes('private-mailbox-password'));
  assert.equal((await request('','GET',undefined,'bob')).data.schedules.length,0);
  assert.equal((await request('/'+id+'/runs','GET',undefined,'bob')).status,404);
  await db.query('INSERT INTO agent_scheduler_heartbeat(id,last_seen) VALUES(1,now())');
  assert.equal((await request('/'+id+'/run','POST',{})).status,200);await schedulerTick(store,{run:async()=>({answer:'Saved scheduled report',sources:[]})});
  const history=await request('/'+id+'/runs');assert.equal(history.data.runs[0].answer,'Saved scheduled report');assert.equal(history.data.runs[0].state,'succeeded');assert.equal((await request()).data.schedules[0].enabled,false);
  const edit=await request('/'+id+'/preview','POST',{});const timing=await request('/preview','POST',{draftId:edit.data.draftId,cron:'0 9 * * 1-5',timezone:'America/New_York',title:'New time'});assert.equal((await request('/'+id,'PATCH',{draftId:timing.data.draftId})).data.schedule.cron,'0 9 * * 1-5');
  const naturalTiming=await request('/preview','POST',{draftId:timing.data.draftId,timingDescription:'Every weekday at 10 AM',timezone:'America/New_York'});assert.equal(naturalTiming.data.plan.cron,'0 10 * * 1-5');assert.equal(naturalTiming.data.plan.timingSummary,'Every weekday at 10:00 AM');
  assert.equal((await request('/'+id,'DELETE',undefined,'bob')).status,404);assert.equal((await request('/'+id,'DELETE')).status,200);assert.equal((await request()).data.schedules.length,0);
 }finally{await new Promise(resolve=>server.close(resolve));await store.close();}
});
