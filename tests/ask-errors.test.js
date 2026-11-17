import test from 'node:test';
import assert from 'node:assert/strict';
import {askFailure} from '../server/ask-errors.js';
import {providerError} from '../server/oauth-errors.js';
import {isLatestEmailQuestion,latestEmailAnswer} from '../server/latest.js';
test('OpenAI errors are distinguished from mailbox authorization and quota',()=>{
 assert.equal(askFailure({service:'openai',status:401}).code,'openai_auth_failed');
 assert.equal(askFailure({authenticationFailed:true}).code,'imap_auth_failed');
 const quota=providerError(429,{error:{code:'insufficient_quota'}});quota.service='openai';assert.equal(askFailure(quota).code,'openai_quota_exhausted');
 assert.equal(askFailure({service:'openai',status:429}).code,'openai_rate_limited');
 assert.equal(askFailure({service:'openai',status:404}).code,'openai_model_unavailable');
});
test('latest shortcut only accepts simple requests, not filtered or analytical questions',()=>{
 for(const q of ['what is my last email?','Read my latest email','What’s the most recent message?','show me the newest email'])assert.ok(isLatestEmailQuestion(q),q);
 for(const q of ['what is my last email from Maya?','is my latest email urgent?','summarize my latest email','what is my last email about project X'])assert.equal(isLatestEmailQuestion(q),false,q);
});
test('direct answer uses email text with source metadata and handles empty inbox',()=>{
 const result=latestEmailAnswer([{id:'imap-3',from:'Sender',subject:'Review',date:'2026-11-17',body:'Review tomorrow',excerpt:'Review tomorrow'}]);
 assert.match(result.answer,/Review tomorrow/);assert.equal(result.sources[0].body,undefined);assert.equal(result.searched,1);assert.equal(latestEmailAnswer([]).searched,0);
});
