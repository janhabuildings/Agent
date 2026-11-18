import {randomUUID} from 'node:crypto';
import {ScheduleStore,schedulingConfigured} from './store.js';
import {interpretSchedule,validateSchedule,connectionsForPlan,sessionIdentities,availableSources} from './plan.js';
import {aiText} from './runner.js';
let singleton;
export function configuredStore(){if(!schedulingConfigured())return null;singleton ||= new ScheduleStore();return singleton;}
export function mountScheduleRoutes(app,{storeProvider=configuredStore,ai=aiText}={}){
 const auth=(req,res,next)=>{if(!sessionIdentities(req.session).length)return res.status(401).json({error:'Connect your email or JBI CRM to manage schedules.'});next();};
 const wrap=handler=>async(req,res)=>{try{await handler(req,res);}catch(error){const message=error.schedulePublic||'Scheduling request failed. Check database setup, saved connections and task details.';res.status(error.scheduleStatus||400).json({error:message});}};
 const fail=(message,status=400)=>{const error=Error(message);error.schedulePublic=message;error.scheduleStatus=status;throw error;};
 const store=()=>{const value=storeProvider();if(!value)fail('Scheduling storage is not configured. Add DATABASE_URL and SCHEDULE_ENCRYPTION_KEY to Render and the schedule worker.',503);return value;};
 const active=async value=>{const seen=await value.heartbeat();return Boolean(seen&&Date.now()-new Date(seen).getTime()<5*60000);};
 const draft=(session,plan)=>{session.scheduleDrafts ||= new Map();for(const [id,item] of session.scheduleDrafts)if(Date.now()>item.expires)session.scheduleDrafts.delete(id);while(session.scheduleDrafts.size>=5)session.scheduleDrafts.delete(session.scheduleDrafts.keys().next().value);const id=randomUUID();session.scheduleDrafts.set(id,{plan,expires:Date.now()+30*60000});return {draftId:id,plan};};
 const readDraft=(session,id)=>{const value=session.scheduleDrafts?.get(id);if(!value||Date.now()>value.expires)fail('This task preview expired. Preview the task again before saving.');return value.plan;};
 const checked=(value)=>{try{return validateSchedule(value);}catch(error){fail(error.message);}};
 app.get('/api/schedules/status',wrap(async(req,res)=>{const value=storeProvider();if(!value)return res.json({configured:false,workerActive:false,availableSources:availableSources(req.session),delivery:'in_app'});try{await value.init();const seen=await value.heartbeat();res.json({configured:true,workerActive:Boolean(seen&&Date.now()-new Date(seen).getTime()<5*60000),lastWorkerSeen:seen,availableSources:availableSources(req.session),delivery:'in_app'});}catch(error){res.status(503).json({configured:false,workerActive:false,error:error.schedulePublic||'The scheduling database could not be reached.'});}}));
 app.get('/api/schedules',auth,wrap(async(req,res)=>res.json({schedules:await store().list(req.session)})));
 app.post('/api/schedules/preview',auth,wrap(async(req,res)=>{
  if(req.body?.draftId){
   const previous=readDraft(req.session,req.body.draftId);let timing={};
   if(req.body.timingDescription){
    if(req.session.lastScheduleTiming&&Date.now()-req.session.lastScheduleTiming<10000)fail('Wait 10 seconds before interpreting another timing change.',429);req.session.lastScheduleTiming=Date.now();
    if(typeof req.body.timingDescription!=='string'||req.body.timingDescription.length>500)fail('Describe the new timing in up to 500 characters.');
    if(req.session.pending)fail('Wait for the current request.',429);req.session.pending=true;
    try{const result=JSON.parse(await ai([{role:'system',content:'Translate the requested recurring timing into JSON with supported (boolean), explanation, cron (five fields) and timezone (IANA). One-time schedules, intervals under 15 minutes and timings that need multiple expressions are unsupported. Never generate a cron cross-product that adds extra runs. Change timing only, not the task. If unclear, supported=false.'},{role:'user',content:JSON.stringify({requestedTiming:req.body.timingDescription,currentTimezone:req.body.timezone||previous.timezone})}],{json:true}));if(result.supported!==true)fail(typeof result.explanation==='string'?result.explanation.slice(0,500):'Please clarify the recurring timing.');timing={cron:result.cron,timezone:result.timezone};}finally{req.session.pending=false;}
   }
   return res.json({supported:true,...draft(req.session,checked({...previous,title:req.body.title??previous.title,cron:req.body.cron??previous.cron,timezone:req.body.timezone??previous.timezone,...timing}))});
  }
  if(req.session.pending)fail('Wait for the current request before interpreting a task.',429);
  if(req.session.lastSchedulePreview && Date.now()-req.session.lastSchedulePreview<10000)fail('Wait 10 seconds before interpreting another task.',429);
  req.session.lastSchedulePreview=Date.now();req.session.pending=true;
  try{const result=await interpretSchedule(req.body?.description,req.body?.timezone||'America/New_York',ai);res.json(result.supported?{...result,...draft(req.session,result.plan)}:result);}catch(error){fail(error.service==='openai'?'OpenAI could not interpret this task. Use Test AI connection in Settings to diagnose it.':error.message);}finally{req.session.pending=false;}
 }));
 app.post('/api/schedules',auth,wrap(async(req,res)=>{
  if(req.body?.consent!==true)fail('Approve encrypted storage of the selected connections before saving.');
  const plan=checked(readDraft(req.session,req.body.draftId));let connections;try{connections=connectionsForPlan(req.session,plan);}catch(error){fail(error.message);}
  const value=store();const enabled=req.body.enabled!==false;if(enabled && !await active(value))fail('The schedule worker is not running yet. Start the worker or save this schedule paused.',409);
  const item=await value.create(req.session,plan,connections,{enabled});req.session.scheduleDrafts.delete(req.body.draftId);res.status(201).json({schedule:item});
 }));
 app.post('/api/schedules/:id/preview',auth,wrap(async(req,res)=>{if(!validId(req.params.id))fail('Schedule not found.',404);const row=await store().getOwned(req.session,req.params.id);if(!row)fail('Schedule not found.',404);res.json({supported:true,...draft(req.session,checked(store().decrypt(row)))});}));
 app.patch('/api/schedules/:id',auth,wrap(async(req,res)=>{
  if(!validId(req.params.id))fail('Schedule not found.',404);const value=store();const row=await value.getOwned(req.session,req.params.id);if(!row)fail('Schedule not found.',404);
  let plan,connections;
  if(req.body?.draftId){if(row.lease_until&&new Date(row.lease_until)>new Date())fail('Wait for the running task to finish before editing it.',409);plan=checked(readDraft(req.session,req.body.draftId));if([...plan.sources].sort().join(',')!==[...value.decrypt(row).sources].sort().join(','))fail('Create a new schedule to change data sources. Existing schedules can change their task and timing.');}
  if(req.body?.refreshConnections){if(req.body.consent!==true)fail('Approve encrypted storage before refreshing saved connections.');try{connections=connectionsForPlan(req.session,plan||value.decrypt(row));}catch(error){fail(error.message);}}
  if(req.body?.enabled===true && !await active(value))fail('Start the schedule worker before resuming this task.',409);
  const item=await value.update(req.session,req.params.id,{plan,connections,enabled:typeof req.body?.enabled==='boolean'?req.body.enabled:undefined});res.json({schedule:item});
 }));
 app.post('/api/schedules/:id/run',auth,wrap(async(req,res)=>{if(!validId(req.params.id))fail('Schedule not found.',404);const value=store();if(!await active(value))fail('The schedule worker must be running to queue a report.',409);const row=await value.getOwned(req.session,req.params.id);if(!row)fail('Schedule not found.',404);if(row.lease_until&&new Date(row.lease_until)>new Date())fail('This task is already running.',409);const item=await value.update(req.session,req.params.id,{runNow:true});if(!item)fail('Schedule not found.',404);res.json({schedule:item,message:'Queued for the next worker check.'});}));
 app.get('/api/schedules/:id/runs',auth,wrap(async(req,res)=>{if(!validId(req.params.id))fail('Schedule not found.',404);const runs=await store().runs(req.session,req.params.id);if(!runs)fail('Schedule not found.',404);res.json({runs});}));
 app.delete('/api/schedules/:id',auth,wrap(async(req,res)=>{if(!validId(req.params.id)||!await store().remove(req.session,req.params.id))fail('Schedule not found.',404);res.json({ok:true});}));
 app.delete('/api/schedules/connections/:source',auth,wrap(async(req,res)=>{if(!['email','crm'].includes(req.params.source))fail('Unknown connection.');await store().revoke(req.session,req.params.source);res.json({ok:true});}));
}
function validId(value){return typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);}
