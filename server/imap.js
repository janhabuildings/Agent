import { RETRIEVAL_LIMITS,withRetrieval } from './retrieval.js';
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { imapAttachments, MAX_ATTACHMENT_BYTES } from './attachments.js';
export function createImapClient(credentials) {
  return new ImapFlow({host:'imap.hostinger.com',port:993,secure:true,tls:{rejectUnauthorized:true,minVersion:'TLSv1.2'},auth:{user:credentials.email,pass:credentials.password},logger:false,disableAutoIdle:true,connectionTimeout:15000,greetingTimeout:15000,socketTimeout:30000});
}
async function withInbox(credentials, action, createClient=createImapClient) {
  const client=createClient(credentials);
  // IMAP errors can contain server text: never log raw error objects.
  client.on('error',()=>{});
  try {
    await client.connect();
    const lock=await client.getMailboxLock('INBOX',{readOnly:true});
    try {return await action(client);} finally {lock.release();}
  } finally {try {await client.logout();} catch {client.close();}}
}
export async function verifyImap(credentials, createClient) {
  await withInbox(credentials,async()=>{},createClient);
}
export function imapCriteria(query, now=new Date()) {
  return query ? {text:query} : {since:new Date(now.getTime()-30*24*60*60*1000)};
}
export async function readImapMessages(credentials, query, createClient, {latestOnly=false,limit=RETRIEVAL_LIMITS.emailMessages}={}) {
  return withInbox(credentials,async client=>{
    const uids=await client.search(latestOnly?{all:true}:imapCriteria(query),{uid:true});
    if(!Array.isArray(uids)||!uids.length)return withRetrieval([],{totalMatches:0,limited:false});
    limit=Math.max(1,Math.min(RETRIEVAL_LIMITS.emailMessages,Math.floor(limit)||RETRIEVAL_LIMITS.emailMessages));
    const selected=uids.sort((a,b)=>a-b).slice(latestOnly?-1:-limit).reverse();
    const messages=[];
    // PEEK source fetches and EXAMINE read-only mode preserve unread flags.
    for await (const message of client.fetch(selected.join(','),{uid:true,bodyStructure:true,source:{start:0,maxLength:200000}},{uid:true})) {
      const mail=await simpleParser(message.source,{skipHtmlToText:false,skipTextToHtml:true,skipImageLinks:true});
      const body=(mail.text||'').slice(0,RETRIEVAL_LIMITS.emailBodyCharacters);
      messages.push({id:`imap-${message.uid}`,subject:mail.subject||'(No subject)',from:mail.from?.text||'',date:mail.date?.toISOString()||'',body,bodyTruncated:(mail.text||'').length>body.length,excerpt:body.slice(0,1200),attachments:imapAttachments(message.bodyStructure,message.uid,client.mailbox?.uidValidity)});
    }
    return withRetrieval(messages.sort((a,b)=>Number(b.id.slice(5))-Number(a.id.slice(5))),{totalMatches:uids.length,limit:latestOnly?1:limit,limited:uids.length>selected.length});
  },createClient);
}
export function imapErrorMessage(error) {
  return error.authenticationFailed ? 'Hostinger rejected the sign-in. Check your full email address and mailbox password. If required by your account, use an app password.' : 'Could not connect to Hostinger securely. Please retry. If it continues, check that IMAP access is enabled for your mailbox.';
}

export async function downloadImapAttachment(credentials,attachment,createClient){
 return withInbox(credentials,async client=>{
  if(attachment.uidValidity && attachment.uidValidity!==String(client.mailbox?.uidValidity))throw Error('Mailbox changed; search again');
  const item=await client.download(attachment.uid,attachment.part,{uid:true,maxBytes:MAX_ATTACHMENT_BYTES+1,decodeText:false});
  if(!item.content)throw Error('Attachment not found');
  const chunks=[];let size=0;
  for await(const chunk of item.content){size+=chunk.length;if(size>MAX_ATTACHMENT_BYTES){item.content.destroy();const error=Error('Attachment exceeds 10 MB');error.status=413;throw error;}chunks.push(chunk);}
  return Buffer.concat(chunks);
 },createClient);
}
