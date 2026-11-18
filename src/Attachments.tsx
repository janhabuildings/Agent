import {useState} from 'react';
import {Download,FileText} from 'lucide-react';
export type Attachment={id:string;filename:string;mimeType:string;size:number;readStatus?:string};
export function Attachments({attachments}:{attachments:Attachment[]}){
 const [busy,setBusy]=useState<string|null>(null);const [error,setError]=useState('');const [reading,setReading]=useState<{filename:string;text:string;notice:string}|null>(null);
 async function act(file:Attachment,read:boolean){
  if(busy)return;setBusy(file.id+(read?'-read':'-download'));setError('');if(read)setReading(null);
  try{
   const response=await fetch(`/api/attachments/${encodeURIComponent(file.id)}/${read?'read':'download'}`,{method:read?'POST':'GET'});
   if(!response.ok){const result=await response.json();throw Error(result.error||'Could not open this attachment.');}
   if(read){const result=await response.json();setReading({filename:file.filename,text:result.text||'',notice:result.notice||''});}
   else{const blob=await response.blob();const url=URL.createObjectURL(blob);const link=document.createElement('a');link.href=url;link.download=file.filename;document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);}
  }catch(e){setError(e instanceof Error?e.message:'Attachment request failed.');}finally{setBusy(null);}
 }
 return <section className="attachment-list" aria-label="Email attachments"><h3>Attachments</h3>{attachments.map(file=><div className="attachment-file" key={file.id}><FileText size={17}/><div><strong>{file.filename}</strong><small>{file.size?`${Math.ceil(file.size/1024)} KB`:'Size unknown'}{file.readStatus?` · ${file.readStatus.replace('_',' ')}`:''}</small></div><button disabled={!!busy} onClick={()=>void act(file,true)} aria-label={`Read ${file.filename}`}>{busy===file.id+'-read'?'Reading…':'Read text'}</button><button disabled={!!busy} onClick={()=>void act(file,false)} aria-label={`Download ${file.filename}`}><Download size={16}/></button></div>)}{error&&<p role="alert" className="attachment-error">{error}</p>}{reading&&<div className="attachment-reading" aria-live="polite"><strong>{reading.filename}</strong><small>{reading.notice}</small><pre>{reading.text}</pre></div>}<small>Up to 10 MB per file. Text PDFs, DOCX, XLSX and plain-text files can be read. Scans and images need OCR.</small></section>;
}
