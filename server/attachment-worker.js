import {parentPort,workerData} from 'node:worker_threads';
import yauzl from 'yauzl';
const buffer=Buffer.from(workerData.buffer);
async function checkZip(buffer){
 await new Promise((resolve,reject)=>yauzl.fromBuffer(buffer,{lazyEntries:true,validateEntrySizes:true},(error,zip)=>{
  if(error)return reject(error);let total=0,count=0;
  const fail=error=>{zip.close();reject(error);};zip.on('error',fail);zip.on('end',resolve);
  zip.on('entry',entry=>{
   if(++count>1000 || entry.uncompressedSize>50*1024*1024 || (total+entry.uncompressedSize)>50*1024*1024)return fail(Error('ZIP too large'));
   if(/\/$/.test(entry.fileName)){zip.readEntry();return;}
   zip.openReadStream(entry,(error,stream)=>{
    if(error)return fail(error);
    stream.on('data',chunk=>{total+=chunk.length;if(total>50*1024*1024){stream.destroy();fail(Error('ZIP too large'));}});stream.on('error',fail);stream.on('end',()=>zip.readEntry());stream.resume();
   });
  });zip.readEntry();
 }));
}
try{
 let text='',limited=false;
 if(workerData.type==='text')text=buffer.toString('utf8');
 if(workerData.type==='pdf'){
  const {PDFParse}=await import('pdf-parse');const parser=new PDFParse({data:new Uint8Array(buffer),verbosity:0});
  try{const result=await parser.getText({first:20});text=result.pages.map(page=>page.text).join('\n\n');limited=result.total>20;}finally{await parser.destroy();}
 }
 if(workerData.type==='docx'){await checkZip(buffer);const mammoth=await import('mammoth');text=(await mammoth.default.extractRawText({buffer})).value;}
 if(workerData.type==='xlsx'){
  await checkZip(buffer);const {default:ExcelJS}=await import('exceljs');const workbook=new ExcelJS.Workbook();await workbook.xlsx.load(buffer);const lines=[];let rows=0;
  for(const sheet of workbook.worksheets){lines.push(`Sheet: ${sheet.name}`);sheet.eachRow(row=>{if(rows++<2000)lines.push(row.values.slice(1,51).map(value=>typeof value==='object'&&value?String(value.result??value.text??(value.richText||[]).map(v=>v.text).join('')):String(value??'')).join('\t'));});}text=lines.join('\n');limited=rows>2000;
 }
 text=text.replace(/\u0000/g,'').trim();limited ||= text.length>20000;
 parentPort.postMessage({status:text?'read':'no_text',text:text.slice(0,20000),notice:text?(limited?'Partial extraction: first 20 PDF pages, 2,000 spreadsheet rows, or 20,000 characters.':'Text extracted.'): 'No readable text was found. Scanned PDFs and images need OCR, which is not supported yet.'});
}catch{parentPort.postMessage({status:'failed',text:'',notice:'Could not read this file. It may be damaged, encrypted, too large after decompression, or unsupported.'});}
