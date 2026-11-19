import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {once} from 'node:events';
test('Hostinger latest-email request bypasses AI; AI rejection has a distinct safe error',{timeout:15000},async()=>{
 const reservation=createServer();reservation.listen(0,'127.0.0.1');await once(reservation,'listening');const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
 const base=`http://127.0.0.1:${port}`;
 const child=spawn(process.execPath,['--import','./tests/fixtures/imap-preload.js','server/index.js'],{cwd:new URL('..',import.meta.url),env:{...process.env,PORT:String(port),PUBLIC_BASE_URL:base,APP_ORIGIN:base,OPENAI_API_KEY:'sk-fake-test-key'},stdio:['ignore','pipe','pipe']});
 try{
  await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('API exited before startup');})]);
  assert.equal((await fetch(base+'/api/ai/check',{method:'POST',headers:{Origin:base}})).status,401);
  const login=await fetch(base+'/api/auth/imap',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify({email:'test@example.com',password:'fake-mailbox-password'})});assert.equal(login.status,200);
  const cookie=login.headers.get('set-cookie').split(';')[0];
  const check=await fetch(base+'/api/ai/check',{method:'POST',headers:{Origin:base,Cookie:cookie}});const diagnostic=await check.json();assert.equal(diagnostic.providerCode,'invalid_api_key');assert.equal(diagnostic.upstreamStatus,401);assert.ok(!JSON.stringify(diagnostic).includes('sk-fake-test-key'));assert.equal((await fetch(base+'/api/ai/check',{method:'POST',headers:{Origin:base,Cookie:cookie}})).status,429);
  const ask=question=>fetch(base+'/api/ask',{method:'POST',headers:{Origin:base,Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify({question})});
  const latest=await ask('what is my last email?');assert.equal(latest.status,200);const result=await latest.json();assert.match(result.answer,/The review is on Thursday/);assert.equal(result.sources[0].subject,'Latest project note');
  const file=result.sources[0].attachments[0];assert.equal(file.filename,'review.txt');
  assert.equal((await fetch(`${base}/api/attachments/${file.id}/download`)).status,401);
  const download=await fetch(`${base}/api/attachments/${file.id}/download`,{headers:{Cookie:cookie}});assert.equal(download.status,200);assert.match(download.headers.get('content-disposition'),/attachment/);assert.equal(download.headers.get('content-type'),'application/octet-stream');assert.equal(await download.text(),'Attachment deadline Friday');
  const read=await fetch(`${base}/api/attachments/${file.id}/read`,{method:'POST',headers:{Cookie:cookie,Origin:base}});assert.equal(read.status,200);assert.equal((await read.json()).text,'Attachment deadline Friday');
  assert.equal((await fetch(`${base}/api/attachments/not-a-valid-id/download`,{headers:{Cookie:cookie}})).status,404);
  const otherLogin=await fetch(base+'/api/auth/imap',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify({email:'other@example.com',password:'another-fake-password'})});
  const otherCookie=otherLogin.headers.get('set-cookie').split(';')[0];assert.equal((await fetch(`${base}/api/attachments/${file.id}/download`,{headers:{Cookie:otherCookie}})).status,404);
  const attachmentAnswer=await ask('Summarize the file attached to my latest email');assert.equal(attachmentAnswer.status,200);const grounded=await attachmentAnswer.json();assert.match(grounded.answer,/Friday/);assert.equal(grounded.sources[0].attachments[0].readStatus,'read');
  const analytical=await ask('What needs my attention this week?');assert.equal(analytical.status,502);const error=await analytical.json();assert.equal(error.code,'openai_auth_failed');assert.ok(!JSON.stringify(error).includes('private-provider-details'));assert.ok(!JSON.stringify(result).includes('fake-mailbox-password'));

  const added=await fetch(base+'/api/auth/imap',{method:'POST',headers:{Origin:base,Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify({email:'second@example.com',password:'second-fake-password'})});assert.equal(added.status,200);
  const multiCookie=added.headers.get('set-cookie').split(';')[0];const headers={Origin:base,Cookie:multiCookie,'Content-Type':'application/json'};
  const status=await (await fetch(base+'/api/status',{headers})).json();assert.equal(status.mailboxes.length,2);assert.ok(!JSON.stringify(status).includes('password'));
  const switched=await fetch(base+'/api/mailboxes/select',{method:'POST',headers,body:JSON.stringify({selection:'all'})});assert.equal(switched.status,200);
  assert.equal((await fetch(`${base}/api/attachments/${file.id}/download`,{headers})).status,200);
  assert.equal((await fetch(base+'/api/mailboxes/select',{method:'POST',headers,body:JSON.stringify({selection:'foreign'})})).status,400);
  const original=status.mailboxes.find(a=>a.email==='test@example.com');assert.equal((await fetch(base+'/api/mailboxes/'+original.id,{method:'DELETE',headers})).status,200);
  assert.equal((await fetch(`${base}/api/attachments/${file.id}/download`,{headers})).status,404);
  const remaining=await (await fetch(base+'/api/status',{headers})).json();assert.equal(remaining.mailboxes.length,1);assert.equal(remaining.email,'second@example.com');
 }finally{child.kill();await once(child,'exit');}
});
