import test from 'node:test';
import assert from 'node:assert/strict';
import {scheduleKey,seal,unseal,ownerKey} from '../server/schedules/crypto.js';
import {validateSchedule,nextRun,interpretSchedule,connectionsForPlan} from '../server/schedules/plan.js';
import {runScheduledTask} from '../server/schedules/runner.js';
const task={title:'Morning report',instructions:'Summarize urgent email and upcoming CRM deadlines',cron:'0 8 * * 1-5',timezone:'America/New_York',sources:['email','crm']};
test('AES-GCM protects credentials, authenticates the owner and rejects a wrong key',()=>{
 const key=scheduleKey('random-for-test-'.repeat(4));const encrypted=seal({password:'mail-password',token:'private-token'},key,'owner:connection');assert.ok(!encrypted.includes('mail-password'));assert.deepEqual(unseal(encrypted,key,'owner:connection'),{password:'mail-password',token:'private-token'});assert.throws(()=>unseal(encrypted,key,'other-owner'));assert.throws(()=>unseal(encrypted,scheduleKey('other-test-key-'.repeat(4)),'owner:connection'));assert.notEqual(ownerKey('email:a@example.com',key),ownerKey('email:b@example.com',key));assert.throws(()=>scheduleKey('short'));
});
test('recurrence uses named timezones and accounts for daylight saving changes',()=>{
 const plan=validateSchedule(task,new Date('2026-03-06T14:00:00Z'));assert.equal(plan.nextRuns[0],'2026-03-09T12:00:00.000Z');assert.equal(nextRun(plan,new Date('2026-11-01T12:00:00Z')).toISOString(),'2026-11-02T13:00:00.000Z');
 assert.throws(()=>validateSchedule({...task,cron:'* * * * *'}),/15 minutes/);assert.throws(()=>validateSchedule({...task,timezone:'bad-timezone'}),/timezone/);assert.throws(()=>validateSchedule({...task,sources:['other']}),/sources/);
});
test('free-form interpretation returns a review plan and refuses unsupported or ambiguous tasks',async()=>{
 const result=await interpretSchedule('Every weekday at 8 AM, report on urgent email and CRM deadlines','America/New_York',async()=>JSON.stringify({...task,supported:true,explanation:'Weekday morning report'}));assert.equal(result.supported,true);assert.equal(result.plan.delivery,'in_app');assert.equal(result.plan.action,'read_report');
 const unsupported=await interpretSchedule('Delete old emails every day','America/New_York',async()=>'{"supported":false,"explanation":"Deleting email is not supported."}');assert.equal(unsupported.supported,false);assert.equal(unsupported.plan,undefined);
});
test('only selected sources are persisted and Gmail background access requires offline consent',()=>{
 const session={email:'a@example.com',imap:{email:'a@example.com',password:'private-mail'},crm:{userId:'crm-user',accessToken:'private-crm'}};const selected=connectionsForPlan(session,{sources:['crm']});assert.equal(selected.email,undefined);assert.equal(selected.crm.userId,'crm-user');assert.throws(()=>connectionsForPlan({email:'a@example.com',token:'short-lived'},{sources:['email']}),/background access/);
});
test('background report combines bounded email/CRM data but does not send credentials to AI or trust invented citations',async()=>{
 const connections={email:{provider:'imap',email:'a@example.com',imap:{email:'a@example.com',password:'private-password'}},crm:{userId:'u',accessToken:'private-crm-token'}};let calls=0;
 const result=await runScheduledTask(task,connections,{imap:async()=>[{id:'m1',subject:'Contractor update',from:'Contractor',date:'2026-11-18',body:'Review needed by Thursday.',attachments:[]}],crm:async()=>({table:'job_tasks',label:'Tasks',total:100,limited:true,records:[{id:'crm-task-1',record:{title:'Review',due_date:'2026-11-19'}}],sources:[{id:'crm-task-1',subject:'Review',url:'https://crm.jbius.com/jobs/1'}]}),ai:async messages=>{
  const input=JSON.stringify(messages);assert.ok(!input.includes('private-password'));assert.ok(!input.includes('private-crm-token'));
  if(calls++===0)return '{"emailQuery":"","crmTable":"job_tasks","crmSearch":"","dateMode":"upcoming"}';assert.match(input,/Review needed by Thursday/);assert.match(input,/partial\/unknown completeness/);return '{"answer":"Review is due Thursday. This covers a subset of tasks.","sourceIds":["m1","crm-task-1","invented"]}';
 }});assert.equal(result.sources.length,2);assert.equal(result.limits.length,2);assert.match(result.answer,/Thursday/);
});
