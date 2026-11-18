import {publicSource} from './attachments.js';
export function isLatestEmailQuestion(question) {
 const q=question.toLowerCase().replace(/[?.!]/g,'').replace(/’/g,"'").trim().replace(/\s+/g,' ');
 return /^(?:(?:what is|what's|show|show me|read|read me|tell me about) )?(?:my |the )?(?:last|latest|most recent|newest) (?:email|mail|message)(?: in my inbox)?$/.test(q);
}
export function latestEmailAnswer(messages) {
 const message=messages[0];
 if(!message) return {answer:'Your inbox is empty.',sources:[],searched:0,query:'Latest inbox email (no AI)'};
 const {body}=message;const source=publicSource(message);
 return {answer:`Your latest inbox email:\n\nFrom: ${message.from}\nSubject: ${message.subject}\nReceived: ${message.date || 'Date unavailable'}\n\n${body || '(No readable message text.)'}${message.attachments?.length?'\n\nAttachments: '+message.attachments.map(a=>a.filename).join(', '):''}`,sources:[source],searched:1,query:'Latest inbox email (no AI)'};
}
