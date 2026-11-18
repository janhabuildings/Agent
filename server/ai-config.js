import {createHash} from 'node:crypto';
export function aiDiagnostics(env=process.env){
 const key=env.OPENAI_API_KEY?.trim()||'';
 let warning=null;
 if(!key)warning='No OpenAI API key is loaded by this deployment.';
 else if(/^Bearer\s/i.test(key))warning='The saved value includes a Bearer prefix. Render needs only the API key.';
 else if(/^["']|["']$/.test(key))warning='The saved API key has surrounding quotes. Remove the quotes in Render.';
 else if(/\s/.test(key))warning='The saved API key contains whitespace inside it. Paste the complete key as a single value.';
 else if(!key.startsWith('sk-'))warning='The saved value does not have the expected OpenAI API-key format. Check that this is the secret API key from platform.openai.com.';
 return {keyFingerprint:key?createHash('sha256').update(key).digest('hex').slice(0,12):null,release:(env.RENDER_GIT_COMMIT||'local').slice(0,12),model:env.OPENAI_MODEL||'gpt-4.1-mini',warning};
}
