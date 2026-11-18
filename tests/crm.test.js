import test from 'node:test';
import assert from 'node:assert/strict';
import {crmConfig,signInCrm,readCrm,safeCrmPlan,crmToken} from '../server/crm.js';
const connection=()=>({accessToken:'private-user-token',userId:'verified-user-id',email:'private@example.com',expiresAt:Date.now()+3600000});
test('only public Supabase keys can be used; a service-role key is refused',()=>{
 assert.ok(crmConfig().url.endsWith('.supabase.co'));
 const serviceKey='x.'+Buffer.from(JSON.stringify({role:'service_role'})).toString('base64url')+'.x';
 assert.throws(()=>crmConfig({CRM_SUPABASE_PUBLISHABLE_KEY:serviceKey}));
});
test('sign-in uses the actual CRM auth API and does not retain the password',async()=>{
 const calls=[];const result=await signInCrm('user@example.com','fake-password',async(url,options)=>{calls.push({url,options});return Response.json({access_token:'user-token',refresh_token:'refresh-token',expires_in:3600,user:{id:'user-id',email:'user@example.com'}});});
 assert.match(calls[0].url,/\/auth\/v1\/token\?grant_type=password$/);assert.equal(JSON.parse(calls[0].options.body).password,'fake-password');assert.ok(!JSON.stringify(result).includes('fake-password'));
});
test('record retrieval uses user-token RLS and fixed read-only fields, with source links',async()=>{
 const calls=[];const result=await readCrm(connection(),{table:'projects',search:'Main Street'},async(url,options)=>{calls.push({url,options});return Response.json([{id:'p1',address:'Main Street',project_type:'Alteration',status:'active'}],{headers:{'Content-Range':'0-0/61'}});});
 assert.equal(calls[0].options.method,'GET');assert.equal(calls[0].options.headers.Authorization,'Bearer private-user-token');assert.ok(!new URL(calls[0].url).searchParams.get('select').includes('*'));assert.equal(result.limited,true);assert.equal(result.total,61);assert.equal(result.sources[0].url,'https://crm.jbius.com/projects/p1');assert.ok(!JSON.stringify(result).includes('private-user-token'));
});
test('CRM cannot be made to read arbitrary tables or inject PostgREST filter syntax',()=>{
 assert.equal(safeCrmPlan({table:'user_roles'}).table,'projects');assert.equal(safeCrmPlan({table:'delete from projects'}).table,'projects');const plan=safeCrmPlan({table:'projects',search:'x),id.neq.*,or(id.eq.private)'});assert.ok(!/[(),*]/.test(plan.search));
});
test('non-admin invoice access fails without reading the invoices table',async()=>{
 const calls=[];await assert.rejects(()=>readCrm(connection(),{table:'invoices'},async(url,options)=>{calls.push({url,options});assert.equal(JSON.parse(options.body)._user_id,'verified-user-id');return Response.json(false);}),error=>error.status===403);assert.equal(calls.length,1);assert.ok(calls[0].url.endsWith('/rpc/is_admin'));
});
test('admin can read invoice records but secrets/payment session tokens are not selected',async()=>{
 const calls=[];await readCrm(connection(),{table:'invoices'},async(url,options)=>{calls.push({url,options});return url.endsWith('/rpc/is_admin')?Response.json(true):Response.json([]);});assert.equal(calls.length,2);assert.ok(!new URL(calls[1].url).searchParams.get('select').includes('view_token'));assert.equal(calls[1].options.method,'GET');
});
test('expired CRM access tokens are refreshed without keeping the password',async()=>{
 const c={...connection(),expiresAt:0,refreshToken:'private-refresh'};assert.equal(await crmToken(c,async(url,options)=>{assert.match(url,/refresh_token/);assert.equal(JSON.parse(options.body).refresh_token,'private-refresh');return Response.json({access_token:'renewed',refresh_token:'new-refresh',expires_in:3600});}),'renewed');assert.equal(c.accessToken,'renewed');
});
test('deadline searches use a bounded date filter instead of arbitrary query operators',async()=>{
 let target;await readCrm(connection(),{table:'job_tasks',dateMode:'upcoming'},async(url)=>{target=new URL(url);return Response.json([]);});assert.match(target.searchParams.get('due_date'),/^gte\.\d{4}-\d{2}-\d{2}$/);
});
