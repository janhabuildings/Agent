import {RETRIEVAL_LIMITS} from './retrieval.js';
import {gmailAttachments,publicSource} from './attachments.js';
export function decodeBody(payload) {
  if (!payload || payload.filename) return '';
  if (payload.mimeType === 'text/plain' && payload.body?.data) return Buffer.from(payload.body.data, 'base64url').toString('utf8');
  const parts = payload.parts || [];
  const plain = parts.map(decodeBody).filter(Boolean).join('\n');
  return plain || (payload.mimeType === 'text/html' && payload.body?.data ? Buffer.from(payload.body.data, 'base64url').toString('utf8').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ') : '');
}
export function normalizeMessage(message) {
  const headers = message.payload?.headers || [];
  const get = name => headers.find(h => h.name.toLowerCase() === name)?.value || '';
  const rawBody=decodeBody(message.payload)||message.snippet||'';
  return { id: message.id, attachments:gmailAttachments(message.payload,message.id), subject: get('subject') || '(No subject)', from: get('from'), date: get('date'), body: rawBody.slice(0,RETRIEVAL_LIMITS.emailBodyCharacters), bodyTruncated:rawBody.length>RETRIEVAL_LIMITS.emailBodyCharacters, url: `https://mail.google.com/mail/u/0/#all/${message.id}` };
}
export function validateAnswer(answer, messages) {
  if (typeof answer?.answer !== 'string' || !Array.isArray(answer.sourceIds)) throw new Error('Invalid answer from model');
  const ids = new Set(answer.sourceIds);
  return { answer: answer.answer, sources: messages.filter(m => ids.has(m.id)).map(publicSource) };
}
