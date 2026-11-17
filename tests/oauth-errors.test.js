import test from 'node:test';
import assert from 'node:assert/strict';
import { providerError, oauthFailureCode } from '../server/oauth-errors.js';
test('distinguishes invalid client credentials from an expired sign-in code',()=>{
 for (const code of ['invalid_client','invalid_grant','redirect_uri_mismatch']) assert.equal(oauthFailureCode('token',providerError(400,{error:code})),`google_${code==='redirect_uri_mismatch'?'redirect_mismatch':code}`);
});
test('recognizes a disabled Gmail API from both Google error formats',()=>{
 for (const body of [{error:{details:[{reason:'SERVICE_DISABLED'}]}},{error:{errors:[{reason:'accessNotConfigured'}]}}]) assert.equal(oauthFailureCode('profile',providerError(403,body)),'gmail_api_disabled');
});
test('keeps permission denial distinct from token exchange failure',()=>{
 assert.equal(oauthFailureCode('profile',providerError(403,{})),'gmail_access_denied');
 assert.equal(oauthFailureCode('token',providerError(503,{})),'google_token_failed');
});
test('does not retain arbitrary provider messages, secrets, or error codes',()=>{
 const error=providerError(400,{error:'secret-provider-code',error_description:'secret-token',message:'private email',details:[{reason:'sensitive'}]});
 assert.equal(error.providerCode,undefined);assert.deepEqual(error.reasons,[]);assert.ok(!JSON.stringify(error).includes('secret'));assert.equal(oauthFailureCode('token',error),'google_token_failed');
});
