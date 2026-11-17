export function decodeBody(payload) {
  if (!payload) return '';
  if (payload.mimeType === 'text/plain' && payload.body?.data) return Buffer.from(payload.body.data, 'base64url').toString('utf8');
  const parts = payload.parts || [];
  const plain = parts.map(decodeBody).filter(Boolean).join('\n');
  return plain || (payload.mimeType === 'text/html' && payload.body?.data ? Buffer.from(payload.body.data, 'base64url').toString('utf8').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ') : '');
}
export function normalizeMessage(message) {
  const headers = message.payload?.headers || [];
  const get = name => headers.find(h => h.name.toLowerCase() === name)?.value || '';
  return { id: message.id, subject: get('subject') || '(No subject)', from: get('from'), date: get('date'), body: decodeBody(message.payload).slice(0, 10000) || message.snippet || '', url: `https://mail.google.com/mail/u/0/#all/${message.id}` };
}
export function validateAnswer(answer, messages) {
  if (typeof answer?.answer !== 'string' || !Array.isArray(answer.sourceIds)) throw new Error('Invalid answer from model');
  const ids = new Set(answer.sourceIds);
  return { answer: answer.answer, sources: messages.filter(m => ids.has(m.id)).map(({body, ...source}) => source) };
}
