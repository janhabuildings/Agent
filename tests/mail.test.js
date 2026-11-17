import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeBody, normalizeMessage, validateAnswer } from '../server/mail.js';
test('decodes nested Gmail MIME text and base64url Unicode',()=>{
 const text='Please review the café drawings.';
 assert.equal(decodeBody({parts:[{mimeType:'text/plain',body:{data:Buffer.from(text).toString('base64url')}}]}),text);
});
test('normalizes headers case-insensitively and limits message bodies',()=>{
 const m=normalizeMessage({id:'abc',payload:{mimeType:'text/plain',headers:[{name:'SUBJECT',value:'Site visit'}],body:{data:Buffer.from('a'.repeat(11000)).toString('base64url')}}});
 assert.equal(m.subject,'Site visit');assert.equal(m.body.length,10000);assert.equal(m.url,'https://mail.google.com/mail/u/0/#all/abc');
});
test('drops invented citation IDs and never returns email bodies as source metadata',()=>{
 const result=validateAnswer({answer:'Thursday',sourceIds:['valid','invented']},[{id:'valid',body:'private',subject:'Deadline'},{id:'other',body:'private'}]);
 assert.deepEqual(result.sources,[{id:'valid',subject:'Deadline'}]);
});
test('rejects malformed model answers',()=>assert.throws(()=>validateAnswer({answer:3,sourceIds:[]},[])));
