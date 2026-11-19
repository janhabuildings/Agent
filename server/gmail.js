import {normalizeMessage} from './mail.js';
import {RETRIEVAL_LIMITS,concurrentMap,withRetrieval} from './retrieval.js';
export async function readGmailMessages(token,query,fetchJson,{limit=RETRIEVAL_LIMITS.emailMessages}={}){
 limit=Math.max(1,Math.min(RETRIEVAL_LIMITS.emailMessages,Math.floor(limit)||RETRIEVAL_LIMITS.emailMessages));
 const headers={Authorization:`Bearer ${token}`};const ids=[];const seen=new Set();const pageTokens=new Set();let pageToken,estimate=null,remainingPage=false;
 do{
  const params=new URLSearchParams({q:query||'in:inbox newer_than:30d',maxResults:String(Math.min(100,limit-ids.length))});if(pageToken)params.set('pageToken',pageToken);
  const page=await fetchJson(`https://gmail.googleapis.com/gmail/v1/users/me/messages?${params}`,{headers});
  if(Number.isFinite(page.resultSizeEstimate))estimate=Math.max(estimate||0,page.resultSizeEstimate);
  for(const message of page.messages||[]){if(!seen.has(message.id)&&ids.length<limit){seen.add(message.id);ids.push(message.id);}}
  pageToken=page.nextPageToken;remainingPage=Boolean(pageToken);if(pageTokens.has(pageToken))break;if(pageToken)pageTokens.add(pageToken);
 }while(pageToken&&ids.length<limit&&pageTokens.size<10);
 const messages=await concurrentMap(ids,RETRIEVAL_LIMITS.gmailConcurrency,async id=>normalizeMessage(await fetchJson(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(id)}?format=full`,{headers})));
 return withRetrieval(messages,{totalMatches:remainingPage?estimate:messages.length,totalIsEstimate:remainingPage,limit,limited:remainingPage});
}
