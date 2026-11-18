// Return only fixed public codes. Never include provider responses or credentials.
export function oauthFailureCode(stage, error) {
  if (error.name === 'TimeoutError' || error.name === 'AbortError') return 'google_timeout';
  if (error.providerCode === 'invalid_client') return 'google_invalid_client';
  if (error.providerCode === 'invalid_grant') return 'google_invalid_grant';
  if (error.providerCode === 'redirect_uri_mismatch') return 'google_redirect_mismatch';
  if (stage === 'profile') {
    if (error.reasons?.some(r => ['SERVICE_DISABLED','API_DISABLED','accessNotConfigured'].includes(r))) return 'gmail_api_disabled';
    if (error.status === 403) return 'gmail_access_denied';
    if (error.status === 401) return 'gmail_token_rejected';
    return 'gmail_profile_failed';
  }
  return 'google_token_failed';
}
export function providerError(status, body) {
  const error = new Error('External service request failed');
  error.status = status;
  const code = typeof body?.error === 'string' ? body.error : body?.error?.code || body?.error?.type || '';
  error.providerCode = ['invalid_client','invalid_grant','redirect_uri_mismatch','invalid_api_key','insufficient_quota','model_not_found','account_deactivated','organization_deactivated','invalid_organization','invalid_project','mismatched_project'].includes(code) ? code : undefined;
  const candidates = [...(Array.isArray(body?.error?.errors) ? body.error.errors : []), ...(Array.isArray(body?.error?.details) ? body.error.details : [])];
  error.reasons = candidates.map(item => item?.reason).filter(r => ['SERVICE_DISABLED','API_DISABLED','accessNotConfigured'].includes(r));
  return error;
}
