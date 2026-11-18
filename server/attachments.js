import {randomBytes} from 'node:crypto';
import {Worker} from 'node:worker_threads';
export const MAX_ATTACHMENT_BYTES=10*1024*1024;
export function imapAttachments(node,uid,uidValidity){
 if(!node)return [];
 const children=(node.childNodes||[]).flatMap(n=>imapAttachments(n,uid,uidValidity));
 const filename=node.dispositionParameters?.filename||node.parameters?.name;
 if(!node.part || (!filename && node.disposition!=='attachment'))return children;
 return [{provider:'imap',uid,uidValidity:String(uidValidity??''),part:node.part,filename:filename||'attachment',mimeType:node.type||'application/octet-stream',size:node.size||0},...children];
}
export function gmailAttachments(node,messageId){
 if(!node)return [];
 const children=(node.parts||[]).flatMap(n=>gmailAttachments(n,messageId));
 if(!node.filename)return children;
 return [{provider:'gmail',messageId,part:node.partId,attachmentId:node.body?.attachmentId,inlineData:node.body?.data,filename:node.filename,mimeType:node.mimeType||'application/octet-stream',size:node.body?.size||0},...children];
}
export function registerAttachments(session,messages){
 session.attachments ||= new Map();
 for(const message of messages){
  message.attachments=(message.attachments||[]).slice(0,30).map(attachment=>{
   const id=randomBytes(16).toString('hex');session.attachments.set(id,attachment);
   while(session.attachments.size>300)session.attachments.delete(session.attachments.keys().next().value);
   return {id,filename:attachment.filename,mimeType:attachment.mimeType,size:attachment.size};
  });
 }
 return messages;
}
export function extractionType(attachment){
 const name=attachment.filename.toLowerCase();
 if(name.endsWith('.pdf')||attachment.mimeType==='application/pdf')return 'pdf';
 if(name.endsWith('.docx'))return 'docx';
 if(name.endsWith('.xlsx'))return 'xlsx';
 if(/\.(txt|csv|md|json|log|tsv)$/.test(name)||attachment.mimeType==='text/plain')return 'text';
 return null;
}
let activeWorkers=0;
export async function extractAttachment(buffer,attachment){
 if(buffer.length>MAX_ATTACHMENT_BYTES)return {status:'too_large',text:'',notice:'File exceeds the 10 MB reading limit.'};
 const type=extractionType(attachment);
 if(!type)return {status:'unsupported',text:'',notice:'Text reading is supported for PDF, DOCX, XLSX, TXT, CSV, MD, JSON and TSV. Download this file to open it in another app.'};
 if(activeWorkers>=1)return {status:'busy',text:'',notice:'File reading is busy. Please try again.'};
 activeWorkers++;
 try{
  return await new Promise(resolve=>{
   const worker=new Worker(new URL('./attachment-worker.js',import.meta.url),{workerData:{buffer,type},resourceLimits:{maxOldGenerationSizeMb:192,stackSizeMb:4}});
   let settled=false;
   const finish=result=>{if(settled)return;settled=true;clearTimeout(timer);void worker.terminate();resolve(result);};
   const timer=setTimeout(()=>finish({status:'timeout',text:'',notice:'File reading exceeded the 20-second limit. Download the file to view it.'}),20000);
   worker.once('message',finish);worker.once('error',()=>finish({status:'failed',text:'',notice:'Could not read this file. It may be damaged, password-protected or too complex.'}));worker.once('exit',()=>finish({status:'failed',text:'',notice:'The file reader stopped before completing this file.'}));
  });
 }finally{activeWorkers--;}
}
export function attachmentListingIntent(question){return /^(?:please )?(?:download|list|show)(?: me)? (?:the |my )?(?:attachments?|files?)(?: (?:from|in|on) (?:the |my )?(?:last|latest|newest) email)?[?.!]?$/i.test(question.trim());}
export function attachmentIntent(question){return /\b(attach(?:ment|ments|ed)?|pdf|docx?|xlsx?|spreadsheet|files?|document)\b/i.test(question);}
export function latestAttachmentIntent(question){return attachmentIntent(question)&&/\b(last|latest|newest|most recent)\b/i.test(question);}
export function publicSource(message){const {body,attachmentText,...source}=message;return source;}
