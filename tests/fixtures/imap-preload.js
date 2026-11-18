// Loaded only by the isolated API integration test; never by the app entry point.
import {Readable} from 'node:stream';
import {ImapFlow} from 'imapflow';
ImapFlow.prototype.connect=async function(){};
ImapFlow.prototype.getMailboxLock=async function(){return {release(){}};};
ImapFlow.prototype.logout=async function(){};
ImapFlow.prototype.search=async function(){return [1];};
ImapFlow.prototype.fetch=async function*(){yield {uid:1,bodyStructure:{type:'multipart/mixed',childNodes:[{part:'2',type:'text/plain',disposition:'attachment',dispositionParameters:{filename:'review.txt'},size:26}]},source:Buffer.from('From: Test Sender <sender@example.com>\r\nSubject: Latest project note\r\nDate: Tue, 17 Nov 2026 09:00:00 -0500\r\nContent-Type: text/plain\r\n\r\nThe review is on Thursday.')};};
ImapFlow.prototype.download=async function(){return {content:Readable.from([Buffer.from('Attachment deadline Friday')]),meta:{}};};
globalThis.fetch=async (url,options)=>{
 if(url==='https://api.openai.com/v1/chat/completions'){
  const request=JSON.parse(options.body);let content;try{content=JSON.parse(request.messages.at(-1).content);}catch{}
  if(content?.emails?.[0]?.attachmentText){
   if(content.emails[0].attachmentText[0].text!=='Attachment deadline Friday')throw Error('Expected extracted attachment text');
   if(JSON.stringify(content).includes('fake-mailbox-password'))throw Error('Credential leaked');
   return Response.json({choices:[{message:{content:JSON.stringify({answer:'Deadline Friday from review.txt.',sourceIds:['imap-1']})}}]});
  }
 }
 if(url==='https://api.openai.com/v1/chat/completions')return Response.json({error:{code:'invalid_api_key',message:'private-provider-details'}},{status:401});
 throw Error('Unexpected external request in test');
};
