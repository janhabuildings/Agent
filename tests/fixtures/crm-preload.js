import './imap-preload.js';
const previousFetch=globalThis.fetch;
globalThis.fetch=async(url,options)=>{
 const u=new URL(url);
 if(u.pathname==='/auth/v1/token')return Response.json({access_token:'private-crm-access',refresh_token:'private-crm-refresh',expires_in:3600,user:{id:'crm-user-id',email:'crm-test@example.com'}});
 if(u.pathname==='/auth/v1/logout')return new Response(null,{status:204});
 if(u.pathname==='/rest/v1/projects'){
  if(options.method!=='GET'||options.headers.Authorization!=='Bearer private-crm-access')throw Error('Must use CRM user permissions');
  return Response.json([{id:'project-1',address:'Main Street',project_type:'Alteration',status:'active',updated_at:'2026-11-18'}],{headers:{'Content-Range':'0-0/1'}});
 }
 if(url==='https://api.openai.com/v1/chat/completions'){
  const payload=JSON.parse(options.body);
  if(payload.response_format?.json_schema?.name==='crm_answer'){
   if(!payload.messages.at(-1).content.includes('Main Street'))throw Error('Missing retrieved CRM record');
   if(payload.messages.at(-1).content.includes('private-crm-'))throw Error('CRM token leaked');
   return Response.json({choices:[{message:{content:JSON.stringify({answer:'The Main Street alteration project is active.',sourceIds:['crm-projects-project-1','invented']})}}]});
  }
  if(payload.messages[0].content.includes('Choose exactly one table:')&&payload.messages.at(-1).content==='What are my recent projects?')throw Error('A simple recent-project request must bypass AI planning');
  if(payload.messages[0].content.includes('Choose exactly one table:'))return Response.json({choices:[{message:{content:'{"table":"projects","search":""}'}}]});
 }
 return previousFetch(url,options);
};
