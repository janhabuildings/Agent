export const demoMessages = [
  {id:'demo-1',from:'Maya Chen <maya@example.com>',subject:'Riverside — revised drawings',date:'2026-11-17T08:35:00-05:00',body:'The revised Riverside drawings are ready for your review. Please send comments by Thursday at 3 PM. The client walkthrough is Friday at 10 AM.'},
  {id:'demo-2',from:'Daniel Brooks <daniel@example.com>',subject:'Approval needed: site visit',date:'2026-11-17T09:10:00-05:00',body:'Can you confirm the site visit for Wednesday at 9 AM? We need your approval before we book the contractor.'},
  {id:'demo-3',from:'Studio team <team@example.com>',subject:'Weekly studio notes',date:'2026-11-16T16:00:00-05:00',body:'The studio library has been updated. No action is needed.'},
];
export function demoAnswer(question:string) {
  const q=question.toLowerCase();
  const matches=demoMessages.filter(m=>`${m.from} ${m.subject} ${m.body}`.toLowerCase().split(/\W+/).some(word=>word.length>3 && q.includes(word)));
  const selected = /attention|urgent|action|week|today|inbox|summary/.test(q)?demoMessages.slice(0,2):matches;
  return { answer:selected.length?`In this fictional demo inbox:\n\n${selected.map(m=>m.body).join('\n\n')}`:'I couldn’t find that in the fictional demo emails. Try asking about Riverside, the site visit, or what needs your attention.',sources:selected.map(({body,...source})=>source),searched:demoMessages.length };
}
