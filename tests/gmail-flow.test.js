import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {once} from 'node:events';
test('Gmail inline attachments remain downloadable after removing binary data from the session cache',{timeout:15000},async()=>{
 const socket=createServer();socket.listen(0,'127.0.0.1');await once(socket,'listening');const port=socket.address().port;await new Promise(resolve=>socket.close(resolve));const base=`http://127.0.0.1:${port}`;
 const child=spawn(process.execPath,['--import','./tests/fixtures/gmail-preload.js','server/index.js'],{cwd:new URL('..',import.meta.url),env:{...process.env,PORT:String(port),APP_ORIGIN:base,PUBLIC_BASE_URL:base,GOOGLE_REDIRECT_URI:base+'/api/auth/google/callback',GOOGLE_CLIENT_ID:'fake-client',GOOGLE_CLIENT_SECRET:'fake-client-secret',OPENAI_API_KEY:'sk-fake'},stdio:['ignore','pipe','pipe']});
 try{
  await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('API exited');})]);
  const start=await fetch(base+'/api/auth/google',{redirect:'manual'});const state=new URL(start.headers.get('location')).searchParams.get('state');const cookie=start.headers.get('set-cookie').split(';')[0];
  const callback=await fetch(base+'/api/auth/google/callback?'+new URLSearchParams({state,code:'fake-code'}),{headers:{Cookie:cookie},redirect:'manual'});assert.equal(callback.status,302);
  const ask=await fetch(base+'/api/ask',{method:'POST',headers:{Cookie:cookie,Origin:base,'Content-Type':'application/json'},body:JSON.stringify({question:'What is the project status?',query:'project',depth:'thorough'})});assert.equal(ask.status,200);const result=await ask.json();assert.equal(result.depth,'thorough');const attachment=result.sources[0].attachments[0];assert.ok(!JSON.stringify(result).includes('private-google-token'));assert.ok(!JSON.stringify(result).includes('inlineData'));
  const download=await fetch(`${base}/api/attachments/${attachment.id}/download`,{headers:{Cookie:cookie}});assert.equal(download.status,200);assert.equal(await download.text(),'Original inline attachment bytes');
 }finally{child.kill();await once(child,'exit');}
});
