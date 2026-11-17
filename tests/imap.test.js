import test from 'node:test';
import assert from 'node:assert/strict';
import { createImapClient,verifyImap,readImapMessages,imapCriteria,imapErrorMessage } from '../server/imap.js';
function mockClient({fail=false}={}){
 const calls=[];
 const client={on(){},async connect(){calls.push('connect');if(fail)throw {authenticationFailed:true};},async getMailboxLock(folder,options){calls.push({folder,options});return {release(){calls.push('release');}};},async logout(){calls.push('logout');},close(){calls.push('close');},async search(criteria,options){calls.push({criteria,options});return Array.from({length:25},(_,i)=>i+1);},async *fetch(ids,query,options){calls.push({ids,query,options});yield {uid:25,source:Buffer.from('From: Client <client@example.com>\r\nSubject: Project review\r\nDate: Tue, 17 Nov 2026 09:00:00 -0500\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nPlease review drawings by Thursday.')};}};
 return {client,calls};
}
test('Hostinger client pins TLS host and port and disables credential logging',()=>{
 const client=createImapClient({email:'test@example.com',password:'fake'});
 assert.equal(client.options.host,'imap.hostinger.com');assert.equal(client.options.port,993);assert.equal(client.options.secure,true);assert.equal(client.options.tls.rejectUnauthorized,true);assert.equal(client.options.logger,false);
});
test('sign-in verifies the inbox read-only and always releases the connection',async()=>{
 const {client,calls}=mockClient();await verifyImap({},()=>client);
 assert.deepEqual(calls,['connect',{folder:'INBOX',options:{readOnly:true}},'release','logout']);
});
test('authentication failure cleans up and has a safe message',async()=>{
 const {client,calls}=mockClient({fail:true});await assert.rejects(()=>verifyImap({},()=>client));assert.equal(calls.at(-1),'logout');
 assert.match(imapErrorMessage({authenticationFailed:true,responseText:'private'}),/mailbox password/);assert.ok(!imapErrorMessage({responseText:'private'}).includes('private'));
});
test('retrieval limits to 20 messages, bounds bytes, parses MIME, and preserves read-only access',async()=>{
 const {client,calls}=mockClient();const result=await readImapMessages({},'drawings',()=>client);
 const fetch=calls.find(c=>c.ids);assert.equal(fetch.ids.split(',').length,20);assert.equal(fetch.query.source.maxLength,200000);assert.equal(fetch.options.uid,true);
 assert.equal(result[0].subject,'Project review');assert.match(result[0].body,/Thursday/);assert.equal(result[0].id,'imap-25');assert.equal(result[0].url,undefined);assert.equal(calls.at(-1),'logout');
});
test('blank search covers the last 30 days; a phrase is passed as literal IMAP text',()=>{
 assert.deepEqual(imapCriteria('drawings'),{text:'drawings'});assert.equal(imapCriteria('',new Date('2026-11-17T00:00:00Z')).since.toISOString(),'2026-10-18T00:00:00.000Z');
});
