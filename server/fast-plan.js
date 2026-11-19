function normalized(question){return question.toLowerCase().replace(/[?.!]/g,'').replace(/[’']/g,'').trim().replace(/\s+/g,' ');}
export function simpleCrmPlan(question){
 const q=normalized(question);
 const collection=q.match(/^(?:(?:show|list|show me|what are)(?: my| the)? |my |the )?(?:recent |latest )?(projects|clients|jobs|tasks|proposals|invoices)(?: please)?$/);
 if(collection)return {table:collection[1]==='tasks'?'job_tasks':collection[1],search:'',dateMode:'all'};
 if(/^(which tasks have upcoming deadlines|show (?:my )?upcoming (?:tasks|deadlines)|what needs my attention this week)$/.test(q))return {table:'job_tasks',search:'',dateMode:'upcoming'};
 if(/^(?:show |list |what are )?(?:my )?overdue (tasks|invoices)$/.test(q))return {table:q.endsWith('invoices')?'invoices':'job_tasks',search:'',dateMode:'overdue'};
 return null;
}
export function simpleEmailQuery(question,provider){
 const q=normalized(question);
 if(/^(what needs my attention this week|(?:summarize|summarise) (?:my |the )?(?:inbox|recent emails|emails)|(?:give me |show me )?(?:an? )?(?:inbox|email) summary|catch me up on (?:my )?emails)$/.test(q))return {query:provider==='imap'?'':'in:inbox newer_than:7d'};
 return null;
}
