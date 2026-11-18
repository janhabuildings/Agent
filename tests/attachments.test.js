import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import {imapAttachments,gmailAttachments,registerAttachments,extractAttachment,publicSource} from '../server/attachments.js';
function pdf(text){
 const stream=`BT /F1 12 Tf 50 750 Td (${text}) Tj ET`;
 const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`];
 let result='%PDF-1.4\n';const offsets=[0];objects.forEach((obj,i)=>{offsets.push(Buffer.byteLength(result));result+=`${i+1} 0 obj\n${obj}\nendobj\n`;});const start=Buffer.byteLength(result);result+=`xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${start}\n%%EOF`;return Buffer.from(result);
}
test('finds nested IMAP and Gmail attachments without treating email body as an attachment',()=>{
 const imap=imapAttachments({type:'multipart/mixed',childNodes:[{part:'1',type:'text/plain'},{part:'2',type:'application/pdf',size:42,disposition:'attachment',dispositionParameters:{filename:'plan.pdf'}}]},7,123);assert.equal(imap.length,1);assert.equal(imap[0].part,'2');assert.equal(imap[0].uidValidity,'123');
 const gmail=gmailAttachments({parts:[{filename:'plan.pdf',partId:'1',mimeType:'application/pdf',body:{size:12,attachmentId:'private-provider-id'}}]},'msg');assert.equal(gmail[0].attachmentId,'private-provider-id');
 const session={};const messages=registerAttachments(session,[{attachments:gmail}]);assert.ok(!JSON.stringify(messages).includes('private-provider-id'));assert.equal(session.attachments.size,1);assert.ok(!('attachmentText' in publicSource({body:'secret',attachmentText:'secret',id:'m'})));
});
test('extracts plain-text files and reports unsupported and oversized files honestly',async()=>{
 assert.equal((await extractAttachment(Buffer.from('Deadline Friday'),{filename:'note.txt'})).text,'Deadline Friday');
 assert.equal((await extractAttachment(Buffer.from('image'),{filename:'scan.png'})).status,'unsupported');assert.equal((await extractAttachment(Buffer.alloc(10*1024*1024+1),{filename:'large.txt'})).status,'too_large');
});
test('extracts real PDF, DOCX and XLSX documents in bounded workers',{timeout:60000},async()=>{
 const pdfResult=await extractAttachment(pdf('PDF deadline Thursday'),{filename:'plan.pdf'});assert.equal(pdfResult.status,'read',pdfResult.notice);assert.match(pdfResult.text,/PDF deadline Thursday/);
 const zip=new JSZip();zip.file('[Content_Types].xml','<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');zip.file('_rels/.rels','<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');zip.file('word/document.xml','<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Word deadline Monday</w:t></w:r></w:p></w:body></w:document>');
 const docResult=await extractAttachment(await zip.generateAsync({type:'nodebuffer'}),{filename:'note.docx'});assert.equal(docResult.status,'read',docResult.notice);assert.match(docResult.text,/Word deadline Monday/);
 const workbook=new ExcelJS.Workbook();workbook.addWorksheet('Budget').addRow(['Project','Cost',123]);const xlsxResult=await extractAttachment(Buffer.from(await workbook.xlsx.writeBuffer()),{filename:'budget.xlsx'});assert.equal(xlsxResult.status,'read',xlsxResult.notice);assert.match(xlsxResult.text,/Budget/);assert.match(xlsxResult.text,/123/);
});
test('corrupt PDFs are not claimed to have been read',async()=>assert.equal((await extractAttachment(Buffer.from('not a pdf'),{filename:'bad.pdf'})).status,'failed'));

test('PDF without text is reported as needing OCR rather than falsely read',async()=>{const result=await extractAttachment(pdf(''),{filename:'scan.pdf'});assert.equal(result.status,'no_text');assert.match(result.notice,/OCR/);});
