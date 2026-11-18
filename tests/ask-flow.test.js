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
  const analytical=await ask('What needs my attention this week?');assert.equal(analytical.status,502);const error=await analytical.json();assert.equal(error.code,'openai_auth_failed');assert.ok(!JSON.stringify(error).includes('private-provider-details'));assert.ok(!JSON.stringify(result).includes('fake-mailbox-password'));
 }finally{child.kill();await once(child,'exit');}
});
