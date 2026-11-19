import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {once} from 'node:events';
test('CRM sign-in, read-only answering, cited sources, email coexistence and disconnect',{timeout:15000},async()=>{
 const reservation=createServer();reservation.listen(0,'127.0.0.1');await once(reservation,'listening');const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));const base=`http://127.0.0.1:${port}`;
 const child=spawn(process.execPath,['--import','./tests/fixtures/crm-preload.js','server/index.js'],{cwd:new URL('..',import.meta.url),env:{...process.env,PORT:String(port),APP_ORIGIN:base,PUBLIC_BASE_URL:base,OPENAI_API_KEY:'sk-test-key'},stdio:['ignore','pipe','pipe']});
 try{
  await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('API exited');})]);
  const post=(path,body,cookie)=>fetch(base+path,{method:'POST',headers:{Origin:base,'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},body:JSON.stringify(body)});
  assert.equal((await post('/api/crm/ask',{question:'List projects'})).status,401);
  const emailLogin=await post('/api/auth/imap',{email:'test@example.com',password:'fake-mail-password'});const emailCookie=emailLogin.headers.get('set-cookie').split(';')[0];
  const login=await post('/api/auth/crm',{email:'crm-test@example.com',password:'fake-crm-password'},emailCookie);assert.equal(login.status,200);const cookie=login.headers.get('set-cookie').split(';')[0];
  const status=await(await fetch(base+'/api/status',{headers:{Cookie:cookie}})).json();assert.equal(status.connected,true);assert.equal(status.crmConnected,true);assert.ok(!JSON.stringify(status).includes('private-crm-'));
  const response=await post('/api/crm/ask',{question:'What projects are active?'},cookie);assert.equal(response.status,200);const answer=await response.json();assert.match(answer.answer,/Main Street/);assert.equal(answer.sources.length,1);assert.equal(answer.sources[0].url,'https://crm.jbius.com/projects/project-1');assert.equal(answer.sourceType,'crm');
  const quick=await post('/api/crm/ask',{question:'What are my recent projects?',depth:'quick'},cookie);assert.equal(quick.status,200);assert.equal((await quick.json()).depth,'quick');
  const thorough=await post('/api/crm/ask',{question:'What are my recent projects?',depth:'thorough'},cookie);assert.equal(thorough.status,200);assert.equal((await thorough.json()).depth,'thorough');
  await post('/api/disconnect',{},cookie);assert.equal((await(await fetch(base+'/api/status',{headers:{Cookie:cookie}})).json()).crmConnected,true);
  await post('/api/crm/disconnect',{},cookie);assert.equal((await post('/api/crm/ask',{question:'List projects'},cookie)).status,401);
 }finally{child.kill();await once(child,'exit');}
});
