export function askFailure(error) {
  if (error.service === 'openai') {
    if(error.status===401) return {status:502,code:'openai_auth_failed',error:'OpenAI rejected the API key currently loaded by this server. Check that Render has the complete API key without quotes, spaces, or a Bearer prefix, then save and deploy. Your email connection succeeded.'};
    if(error.providerCode==='insufficient_quota') return {status:502,code:'openai_quota_exhausted',error:'OpenAI reports no available API quota. Check billing and project limits in your OpenAI API account. Your email connection is working.'};
    if(error.status===429) return {status:429,code:'openai_rate_limited',error:'OpenAI is rate-limiting requests. Wait a moment and retry, or check your project rate limits.'};
    if(error.status===403) return {status:502,code:'openai_access_denied',error:'OpenAI denied access for this API project or location. Check the key’s project permissions and model access.'};
    if(error.status===404 || error.providerCode==='model_not_found') return {status:502,code:'openai_model_unavailable',error:'The configured OpenAI model is unavailable to this API project. Check OPENAI_MODEL in Render and the project’s model access.'};
    return {status:502,code:'openai_request_failed',error:'The OpenAI service could not complete this request. Please retry. You can still ask “What is my last email?” with Hostinger without AI.'};
  }
  if(error.authenticationFailed) return {status:401,code:'imap_auth_failed',error:'Hostinger rejected the mailbox credentials. Please reconnect your email.'};
  if(error.service==='gmail' && error.status===401) return {status:401,code:'gmail_auth_failed',error:'Gmail authorization expired. Please reconnect Gmail.'};
  return {status:502,code:'email_search_failed',error:'Could not read the matching emails. Please retry or reconnect your mailbox.'};
}
