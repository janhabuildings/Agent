import test from 'node:test';
import assert from 'node:assert/strict';
import {addMailbox,mailboxes,selectedMailboxes,readMailboxes,removeMailbox,publicMailboxes,copyMailboxState} from '../server/mailboxes.js';
import {connectionsForPlan} from '../server/schedules/plan.js';
test('multiple accounts preserve credentials privately and reject foreign selections',()=>{
 const s={};const a=addMailbox(s,{provider:'imap',email:'A@example.com',imap:{email:'a@example.com',password:'private-password'}});
 const next={...copyMailboxState(s)};const b=addMailbox(next,{provider:'imap',email:'b@example.com',imap:{email:'b@example.com',password:'second-password'}});
 assert.equal(mailboxes(next).length,2);assert.equal(mailboxes(s).length,1);assert.equal(selectedMailboxes(next,'all').length,2);assert.throws(()=>selectedMailboxes(next,'foreign'));
 assert.ok(!JSON.stringify(publicMailboxes(next)).includes('password'));
 next.attachments=new Map([['a',{mailboxId:a.id}],['b',{mailboxId:b.id}]]);removeMailbox(next,b.id);assert.equal(next.email,a.email);assert.ok(next.attachments.has('a'));assert.ok(!next.attachments.has('b'));
 assert.throws(()=>connectionsForPlan(next,{sources:['email'],emailAddress:b.email}),/Select the inbox/);
});
test('combined retrieval separates identical UIDs, applies a shared cap and attributes attachments',async()=>{
 const s={};const a=addMailbox(s,{provider:'imap',email:'a@example.com',imap:{email:'a@example.com'}});const b=addMailbox(s,{provider:'imap',email:'b@example.com',imap:{email:'b@example.com'}});const quotas=[];
 const imap=async(credentials,query,_client,options)=>{quotas.push(options.limit);return Array.from({length:options.limit},(_,i)=>({id:'imap-'+i,date:'2026-11-19',attachments:[{messageId:1}],body:credentials.email}));};
 const result=await readMailboxes(mailboxes(s),'',{limit:5,imap});assert.equal(result.length,5);assert.deepEqual(quotas,[3,2]);assert.equal(new Set(result.map(m=>m.id)).size,5);assert.equal(result.retrieval.mailboxes.length,2);assert.equal(result[0].attachments[0].mailboxId,a.id);assert.ok(result.some(m=>m.mailboxEmail===b.email));
 const latest=await readMailboxes(mailboxes(s),'',{latestOnly:true,imap});assert.equal(latest.length,1);
 await assert.rejects(readMailboxes(mailboxes(s),'',{imap:async()=>{throw Error('Mailbox unavailable');}}),/Mailbox unavailable/);
});
