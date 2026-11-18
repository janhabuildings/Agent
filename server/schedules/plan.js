import {CronExpressionParser} from 'cron-parser';
export function validateSchedule(input,now=new Date()){
 const instructions=typeof input.instructions==='string'?input.instructions.trim():'';
 if(!instructions||instructions.length>2000)throw Error('Write a task of up to 2,000 characters.');
 const title=typeof input.title==='string'?input.title.trim().slice(0,100):instructions.slice(0,80);
 const cron=typeof input.cron==='string'?input.cron.trim():'';
 if(cron.split(/\s+/).length!==5)throw Error('Use a recurring five-field cron schedule (minute, hour, day, month, weekday).');
 const timezone=typeof input.timezone==='string'?input.timezone:'America/New_York';
 try{new Intl.DateTimeFormat('en',{timeZone:timezone}).format(now);}catch{throw Error('Choose a valid timezone, such as America/New_York.');}
 const sources=[...new Set(Array.isArray(input.sources)?input.sources:[])];
 if(!sources.length||sources.some(source=>!['email','crm'].includes(source)))throw Error('Choose email, JBI CRM, or both as data sources.');
 let expression;try{expression=CronExpressionParser.parse(cron,{currentDate:now,tz:timezone});}catch{throw Error('The timing is invalid. Edit the schedule and try again.');}
 const next=[];for(let i=0;i<8;i++)next.push(expression.next().toDate());
 for(let i=1;i<next.length;i++)if(next[i]-next[i-1]<15*60000)throw Error('Schedules can run at most once every 15 minutes.');
 return {title,instructions,cron,timezone,sources,timingSummary:describeTiming(cron),delivery:'in_app',action:'read_report',nextRuns:next.slice(0,3).map(date=>date.toISOString())};
}
export function nextRun(plan,after=new Date()){return CronExpressionParser.parse(plan.cron,{currentDate:after,tz:plan.timezone}).next().toDate();}
export function availableSources(session){const result=[];if(session?.imap||(session?.token&&Date.now()<session.tokenExpires))result.push('email');if(session?.crm)result.push('crm');return result;}
export function sessionIdentities(session){return [...(session?.crm?.userId?['crm:'+session.crm.userId]:[]),...(session?.email&&(session?.imap||session?.token)?['email:'+session.email.toLowerCase()]:[])];}
export function connectionsForPlan(session,plan){
 const connections={};
 for(const source of plan.sources){
  if(source==='email'){
   if(session?.imap)connections.email={provider:'imap',email:session.email,imap:{...session.imap}};
   else if(session?.token&&session?.googleRefreshToken)connections.email={provider:'gmail',email:session.email,token:session.token,tokenExpires:session.tokenExpires,refreshToken:session.googleRefreshToken};
   else throw Error('Connect your email first. For Gmail, reconnect once to permit background access.');
  }
  if(source==='crm'){if(!session?.crm)throw Error('Connect JBI CRM first.');connections.crm={...session.crm};delete connections.crm.refreshing;}
 }
 return connections;
}
export async function interpretSchedule(text,timezone,ai){
 if(typeof text!=='string'||!text.trim()||text.length>2000)throw Error('Describe the task and timing in up to 2,000 characters.');
 const result=await ai([{role:'system',content:`Turn the user request into a recurring read-only report schedule. Return JSON with title, instructions, cron (exactly five fields), timezone (IANA), sources (array containing email and/or crm), supported (boolean), and explanation. Keep instructions faithful and complete. The user may freely describe a task. Supported capabilities: search/read up to 20 matching inbox emails; query up to 50 authorized CRM records from a collection; synthesize a report saved inside Agent. No sending email, editing/deleting records, website browsing, attachment OCR, or automatic file downloads. Unsupported actions and one-time dates must be marked supported=false with a clear explanation. Do not silently convert an unsupported action into a report. Resolve timing only when explicitly supplied. If timing is missing or ambiguous, mark supported=false and ask for the missing detail in explanation. Default timezone is ${timezone}. Minimum interval is 15 minutes. Do not generate cron cross-products that add extra runs: if different days require different times and cannot be represented faithfully with one expression, mark supported=false and suggest separate schedules. Never execute the task now. Today is ${new Date().toISOString().slice(0,10)}.`},{role:'user',content:text}],{json:true});
 const parsed=JSON.parse(result);if(parsed.supported!==true)return {supported:false,explanation:typeof parsed.explanation==='string'?parsed.explanation.slice(0,1000):'Please clarify the task and when it should run.'};
 return {supported:true,explanation:typeof parsed.explanation==='string'?parsed.explanation.slice(0,1000):'',plan:validateSchedule(parsed)};
}

export function describeTiming(cron){
 const [minute,hour,day,month,weekday]=cron.split(/\s+/);
 if(/^\d+$/.test(minute)&&/^\d+$/.test(hour)){
  const h=Number(hour);const time=`${h%12||12}:${minute.padStart(2,'0')} ${h<12?'AM':'PM'}`;
  if(day==='*'&&month==='*'){
   if(weekday==='*')return `Every day at ${time}`;
   if(weekday==='1-5')return `Every weekday at ${time}`;
   if(/^[0-6](,[0-6])*$/.test(weekday))return weekday.split(',').map(n=>['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][Number(n)]).join(', ')+` at ${time}`;
  }
  if(/^\d+$/.test(day)&&month==='*'&&weekday==='*')return `Day ${day} of each month at ${time}`;
 }
 if(/^\*\/\d+$/.test(minute)&&[hour,day,month,weekday].every(v=>v==='*'))return `Every ${minute.slice(2)} minutes`;
 return 'Custom recurring schedule; review the next run times below';
}
