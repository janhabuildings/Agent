import test from 'node:test';
import assert from 'node:assert/strict';
import {readGmailMessages} from '../server/gmail.js';
import {emailContext,emailCoverage,withRetrieval,RETRIEVAL_LIMITS} from '../server/retrieval.js';
import {readCrm} from '../server/crm.js';
test('Gmail follows result pages up to 100 unique emails and bounds simultaneous message fetches',async()=>{
 let inFlight=0,peak=0,listCalls=0;
 const result=await readGmailMessages('private-token','project',async(url)=>{
  const u=new URL(url);
  if(u.pathname.endsWith('/messages')){listCalls++;const second=u.searchParams.has('pageToken');return {messages:Array.from({length:60},(_,i)=>({id:String(i+(second?60:0))})),nextPageToken:second?'third':'second',resultSizeEstimate:120};}
  inFlight++;peak=Math.max(peak,inFlight);await new Promise(resolve=>setTimeout(resolve,1));inFlight--;return {id:u.pathname.split('/').at(-1),snippet:'Message body'};
 });assert.equal(result.length,100);assert.equal(listCalls,2);assert.ok(peak<=RETRIEVAL_LIMITS.gmailConcurrency);assert.equal(result.retrieval.limited,true);assert.equal(result.retrieval.totalMatches,120);assert.equal(result.retrieval.totalIsEstimate,true);
});
test('every retrieved email gets body context while the total character budget stays bounded',()=>{
 const messages=withRetrieval(Array.from({length:100},(_,i)=>({id:String(i),body:'x'.repeat(10000),subject:'Subject',from:'Sender',attachments:[{filename:'private.txt',inlineData:'private-base64',attachmentId:'provider-private-id'}]})),{totalMatches:1000,limited:true});
 const context=emailContext(messages);assert.ok(context.every(message=>message.body.length>0));assert.ok(context.reduce((sum,message)=>sum+message.body.length,0)<=RETRIEVAL_LIMITS.emailContextCharacters);assert.ok(context.every(message=>message.bodyTruncated));assert.ok(!JSON.stringify(context).includes('private-base64'));assert.ok(!JSON.stringify(context).includes('provider-private-id'));assert.equal(emailCoverage(messages,context).partial,true);
});
test('CRM paginates 500 records with user RLS and reports the remaining matching records',async()=>{
 let calls=0;
 const result=await readCrm({userId:'u',accessToken:'private-user-token',expiresAt:Date.now()+3600000},{table:'projects'},async(url,options)=>{
  calls++;assert.equal(options.method,'GET');assert.equal(options.headers.Authorization,'Bearer private-user-token');const q=new URL(url).searchParams;assert.equal(q.get('limit'),'100');assert.match(q.get('order'),/id.asc/);const offset=Number(q.get('offset'));return Response.json(Array.from({length:100},(_,i)=>({id:String(offset+i),address:'Address '+(offset+i),status:'active'})),{headers:{'Content-Range':`${offset}-${offset+99}/550`}});
 });assert.equal(calls,5);assert.equal(result.records.length,500);assert.equal(result.retrieved,500);assert.equal(result.total,550);assert.equal(result.limited,true);assert.equal(result.sources.length,500);
});
test('CRM context truncation is disclosed even when all matching rows were fetched',async()=>{
 const result=await readCrm({userId:'u',accessToken:'token',expiresAt:Date.now()+3600000},{table:'clients'},async(url)=>{
  const offset=Number(new URL(url).searchParams.get('offset'));return Response.json(Array.from({length:100},(_,i)=>({id:String(offset+i),name:'Client',notes:'a'.repeat(5000)})),{headers:{'Content-Range':`${offset}-${offset+99}/500`}});
 });assert.equal(result.retrieved,500);assert.ok(result.records.length<500);assert.equal(result.limited,true);assert.equal(result.characterLimited,true);assert.ok(JSON.stringify(result.records).length<RETRIEVAL_LIMITS.crmContextCharacters+5000);
});
test('Quick mode reduces retrieval while Thorough preserves the higher maximum limits',async()=>{
 const {retrievalDepth}=await import('../server/retrieval.js');assert.equal(retrievalDepth('quick').emailMessages,25);assert.equal(retrievalDepth('quick').crmRecords,100);assert.equal(retrievalDepth('thorough').emailMessages,100);assert.equal(retrievalDepth('thorough').crmRecords,500);
 let fetched=0;const messages=await readGmailMessages('token','project',async url=>{if(new URL(url).pathname.endsWith('/messages'))return {messages:Array.from({length:100},(_,i)=>({id:String(i)})),nextPageToken:'next',resultSizeEstimate:200};fetched++;return {id:new URL(url).pathname.split('/').at(-1),snippet:'Email'};},{limit:25});assert.equal(messages.length,25);assert.equal(fetched,25);assert.equal(messages.retrieval.limit,25);
});
