import test from 'node:test';
import assert from 'node:assert/strict';
import {aiDiagnostics} from '../server/ai-config.js';
test('connection diagnostics never return the key and have a stable nonreversible fingerprint',()=>{
 const key='sk-test-secret-value';const a=aiDiagnostics({OPENAI_API_KEY:key,RENDER_GIT_COMMIT:'abc1234567890123'});assert.ok(!JSON.stringify(a).includes(key));assert.equal(a.warning,null);assert.equal(a.keyFingerprint,aiDiagnostics({OPENAI_API_KEY:` ${key}\n`}).keyFingerprint);assert.notEqual(a.keyFingerprint,aiDiagnostics({OPENAI_API_KEY:'sk-other-value'}).keyFingerprint);assert.equal(a.release,'abc123456789');
});
test('detects configuration mistakes without copying input into the warning',()=>{
 for(const key of ['', 'Bearer sk-secret','"sk-secret"',"'sk-secret'",'sk-secret value','google-client-id']){
  const result=aiDiagnostics({OPENAI_API_KEY:key});assert.ok(result.warning);if(key)assert.ok(!result.warning.includes(key));
 }
});
