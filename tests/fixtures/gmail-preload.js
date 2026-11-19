const data=Buffer.from('Original inline attachment bytes').toString('base64url');
globalThis.fetch=async(url,options)=>{
 const u=new URL(url);
 if(u.hostname==='oauth2.googleapis.com')return Response.json({access_token:'private-google-token',refresh_token:'private-google-refresh',expires_in:3600});
 if(u.pathname.endsWith('/profile'))return Response.json({emailAddress:'gmail-test@example.com'});
 if(u.pathname.endsWith('/messages'))return Response.json({messages:[{id:'gmail-message-1'}],resultSizeEstimate:1});
 if(u.pathname.endsWith('/messages/gmail-message-1'))return Response.json({id:'gmail-message-1',payload:{parts:[{partId:'0',mimeType:'text/plain',body:{data:Buffer.from('Project is active').toString('base64url')}},{partId:'1',filename:'note.txt',mimeType:'text/plain',body:{data,size:32}}]}});
 if(u.hostname==='api.openai.com')return Response.json({choices:[{message:{content:JSON.stringify({answer:'Project is active.',sourceIds:[JSON.parse(JSON.parse(options.body).messages.at(-1).content).emails[0].id]})}}]});
 throw Error('Unexpected external test request');
};
