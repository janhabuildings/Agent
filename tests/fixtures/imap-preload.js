// Loaded only by the isolated API integration test; never by the app entry point.
import {ImapFlow} from 'imapflow';
ImapFlow.prototype.connect=async function(){};
ImapFlow.prototype.getMailboxLock=async function(){return {release(){}};};
ImapFlow.prototype.logout=async function(){};
ImapFlow.prototype.search=async function(){return [1];};
ImapFlow.prototype.fetch=async function*(){yield {uid:1,source:Buffer.from('From: Test Sender <sender@example.com>\r\nSubject: Latest project note\r\nDate: Tue, 17 Nov 2026 09:00:00 -0500\r\nContent-Type: text/plain\r\n\r\nThe review is on Thursday.')};};
globalThis.fetch=async url=>{
 if(url==='https://api.openai.com/v1/chat/completions')return Response.json({error:{code:'invalid_api_key',message:'private-provider-details'}},{status:401});
 throw Error('Unexpected external request in test');
};
