import {createHash} from 'node:crypto';
import {readImapMessages} from './imap.js';
import {readGmailMessages} from './gmail.js';
import {withRetrieval} from './retrieval.js';
export const MAX_MAILBOXES=5;
export function mailboxId(provider,email){return createHash('sha256').update(`${provider}:${email.toLowerCase()}`).digest('hex').slice(0,24);}
export function mailboxes(session){
 if(!session)return [];
 if(!session.mailboxes){session.mailboxes=new Map();if(session.email&&(session.imap||session.token)){const provider=session.imap?'imap':'gmail';const account={id:mailboxId(provider,session.email),provider,email:session.email.toLowerCase(),...(session.imap?{imap:session.imap}:{token:session.token,tokenExpires:session.tokenExpires,refreshToken:session.googleRefreshToken})};session.mailboxes.set(account.id,account);session.activeMailboxId=account.id;}}
 return [...session.mailboxes.values()];
}
export function syncMailboxAliases(session){
 const accounts=mailboxes(session);const active=accounts.find(account=>account.id===session.activeMailboxId)||accounts[0];
 for(const key of ['imap','token','tokenExpires','googleRefreshToken','email'])delete session[key];
 if(active){session.activeMailboxId=active.id;session.email=active.email;if(active.provider==='imap')session.imap=active.imap;else{session.token=active.token;session.tokenExpires=active.tokenExpires;session.googleRefreshToken=active.refreshToken;}}
 else{delete session.activeMailboxId;delete session.mailboxSelection;}
 return active;
}
export function copyMailboxState(previous){if(!previous)return {};mailboxes(previous);return {mailboxes:new Map(previous.mailboxes),activeMailboxId:previous.activeMailboxId,mailboxSelection:previous.mailboxSelection,attachments:previous.attachments};}
export function addMailbox(session,account){mailboxes(session);account={...account,email:account.email.toLowerCase(),id:mailboxId(account.provider,account.email)};if(!session.mailboxes.has(account.id)&&session.mailboxes.size>=MAX_MAILBOXES)throw Error(`Connect at most ${MAX_MAILBOXES} mailboxes at once.`);session.mailboxes.set(account.id,account);session.activeMailboxId=account.id;session.mailboxSelection=account.id;syncMailboxAliases(session);return account;}
export function publicMailboxes(session){return mailboxes(session).map(account=>({id:account.id,email:account.email,provider:account.provider==='imap'?'hostinger':'gmail',needsReconnect:account.provider==='gmail'&&!account.refreshToken&&Date.now()>=account.tokenExpires}));}
export function selectedMailboxes(session,selection){
 const accounts=mailboxes(session);const requested=selection??session?.mailboxSelection??session?.activeMailboxId;
 const ids=requested==='all'?accounts.map(account=>account.id):Array.isArray(requested)?requested:typeof requested==='string'?[requested]:accounts[0]?[accounts[0].id]:[];
 if(!ids.length||ids.length>MAX_MAILBOXES)throw Error('Connect and select at least one email account.');
 const result=[...new Set(ids)].map(id=>accounts.find(account=>account.id===id));if(result.some(account=>!account))throw Error('A selected mailbox is not connected. Select a connected account.');return result;
}
export function removeMailbox(session,id){const account=mailboxes(session).find(account=>account.id===id);if(!account)return null;session.mailboxes.delete(id);if(session.mailboxSelection===id)delete session.mailboxSelection;for(const [key,file] of session.attachments||[])if(file.mailboxId===id||!file.mailboxId)session.attachments.delete(key);syncMailboxAliases(session);return account;}
export async function gmailAccessToken(account,fetchJson){
 if(account.token&&Date.now()<account.tokenExpires-30000)return account.token;
 if(!account.refreshToken){const error=Error('Please reconnect this Gmail mailbox.');error.status=401;error.service='gmail';throw error;}
 const token=await fetchJson('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'refresh_token',refresh_token:account.refreshToken,client_id:process.env.GOOGLE_CLIENT_ID||'',client_secret:process.env.GOOGLE_CLIENT_SECRET||''})});
 account.token=token.access_token;account.tokenExpires=Date.now()+Number(token.expires_in||3600)*1000;return account.token;
}
export async function readMailboxes(accounts,queries,{limit=100,latestOnly=false,fetchJson,imap=readImapMessages,gmail=readGmailMessages}={}){
 const combined=[];const coverage=[];
 // One query-wide cap, fairly divided between accounts. At most two accounts read concurrently.
 const work=async(account,index)=>{
  const quota=latestOnly?1:Math.floor(limit/accounts.length)+(index<limit%accounts.length?1:0);if(!quota)return;
  try{
   const query=typeof queries==='string'?queries:queries[account.provider]||'';
   const messages=account.provider==='imap'?await imap(account.imap,query,undefined,{limit:quota,latestOnly}):await gmail(await gmailAccessToken(account,fetchJson),latestOnly?'in:inbox':query,fetchJson,{limit:quota});
   for(const message of messages){const originalId=message.id;message.id=`${account.id}:${originalId}`;message.mailboxId=account.id;message.mailboxEmail=account.email;for(const file of message.attachments||[])file.mailboxId=account.id;if(account.provider==='gmail')message.url=`https://mail.google.com/mail/?authuser=${encodeURIComponent(account.email)}#all/${encodeURIComponent(originalId)}`;combined.push(message);}
   coverage.push({id:account.id,email:account.email,retrieved:messages.length,totalMatches:messages.retrieval?.totalMatches??null,totalIsEstimate:Boolean(messages.retrieval?.totalIsEstimate),limited:Boolean(messages.retrieval?.limited)});
  }catch(error){error.mailboxEmail=account.email;throw error;}
 };
 let next=0;await Promise.all(Array.from({length:Math.min(2,accounts.length)},async()=>{while(next<accounts.length){const index=next++;await work(accounts[index],index);}}));
 combined.sort((a,b)=>(Date.parse(b.receivedAt||b.date)||0)-(Date.parse(a.receivedAt||a.date)||0));
 const messages=combined.slice(0,latestOnly?1:limit);const exact=coverage.every(item=>item.totalMatches!==null);return withRetrieval(messages,{limit,totalMatches:exact?coverage.reduce((sum,item)=>sum+item.totalMatches,0):null,totalIsEstimate:coverage.some(item=>item.totalIsEstimate),limited:coverage.some(item=>item.limited)||combined.length>messages.length,mailboxes:coverage});
}
