import test from 'node:test';
import assert from 'node:assert/strict';
import { getConfig } from '../server/config.js';
test('Render supplies HTTPS origin and OAuth callback without manual URL settings',()=>{
 assert.deepEqual(getConfig({PORT:'10000',RENDER_EXTERNAL_URL:'https://agent-example.onrender.com'}),{port:10000,base:'https://agent-example.onrender.com',origin:'https://agent-example.onrender.com',callback:'https://agent-example.onrender.com/api/auth/google/callback'});
});
test('custom domains override Render defaults and normalize trailing slashes',()=>{
 const config=getConfig({RENDER_EXTERNAL_URL:'https://example.onrender.com',PUBLIC_BASE_URL:'https://agent.example.com/',APP_ORIGIN:'https://agent.example.com/'});
 assert.equal(config.callback,'https://agent.example.com/api/auth/google/callback');assert.equal(config.origin,'https://agent.example.com');
});
test('local development retains separate Vite and API ports',()=>{
 assert.equal(getConfig({}).origin,'http://localhost:5173');assert.equal(getConfig({}).callback,'http://localhost:3001/api/auth/google/callback');
});
