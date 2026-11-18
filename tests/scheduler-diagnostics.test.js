import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {schedulerDiagnostic,databaseConnectionString,logSchedulerFailure} from '../server/schedules/diagnostics.js';
test('scheduler diagnostics distinguish database authentication, networking, permissions and application SQL errors',()=>{
 for(const [code,expected] of [['28P01','database_auth_failed'],['ENOTFOUND','database_hostname_unresolved'],['ECONNREFUSED','database_connection_refused'],['42501','database_permission_denied'],['42601','database_schema_syntax'],['ERR_TLS_CERT_ALTNAME_INVALID','database_tls_hostname']])assert.equal(schedulerDiagnostic({code,scheduleStage:'database_init',message:'private value'}).code,expected);
 const nested=new AggregateError([{code:'ENETUNREACH'}]);assert.equal(schedulerDiagnostic(nested).code,'database_network_unreachable');
 assert.equal(schedulerDiagnostic({code:'42601',position:'123'}).position,123);
});
test('diagnostics never log raw credentials, URLs, provider messages or arbitrary properties',()=>{
 const privateError={code:'28P01',message:'secret password psql://user:secret@internal/db',detail:'private details',stack:'private stack',DATABASE_URL:'private-url'};const lines=[];logSchedulerFailure(privateError,line=>lines.push(line));assert.ok(lines[0].includes('database_auth_failed'));for(const secret of ['psql://','private-url','private stack','private details','user:secret'])assert.ok(!lines[0].includes(secret));
 assert.equal(schedulerDiagnostic({schedulePublic:'The scheduling encryption key does not match this database. private-secret'}).code,'encryption_key_mismatch');assert.ok(!JSON.stringify(schedulerDiagnostic({schedulePublic:'The scheduling encryption key does not match private-secret'})).includes('private-secret'));
});
test('database URL validation refuses PSQL commands and dashboard URLs without echoing their contents',()=>{
 assert.equal(databaseConnectionString(' postgresql://user:password@db/agent '),'postgresql://user:password@db/agent');
 for(const value of ['psql postgresql://user:private-password@db/agent','https://dashboard.render.com/private','"postgresql://user:private@db/agent"']){try{databaseConnectionString(value);assert.fail('Expected invalid URL');}catch(error){assert.equal(schedulerDiagnostic(error).code,'database_url_invalid');assert.ok(!JSON.stringify(schedulerDiagnostic(error)).includes('private-password'));}}
});
test('actual worker process reports an unreachable database safely instead of swallowing the cause',{timeout:20000},async()=>{
 const child=spawn(process.execPath,['server/scheduler-worker.js','--once'],{cwd:new URL('..',import.meta.url),env:{...process.env,DATABASE_URL:'postgresql://fake-user:private-password@127.0.0.1:1/agent',SCHEDULE_ENCRYPTION_KEY:'private-encryption-key-'.repeat(3),OPENAI_API_KEY:'sk-fake-api-key'},stdio:['ignore','pipe','pipe']});let output='';child.stdout.on('data',v=>output+=v);child.stderr.on('data',v=>output+=v);const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);});assert.equal(code,1);assert.match(output,/database_connection_refused/);assert.match(output,/database_init/);for(const secret of ['private-password','private-encryption-key','sk-fake-api-key','fake-user'])assert.ok(!output.includes(secret),output);
});
