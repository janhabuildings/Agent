const messages: Record<string,string> = {
 cancelled: 'Gmail sign-in was cancelled. You can connect again when ready.',
 failed: 'Gmail connection failed. Please connect again to get a specific error message.',
 google_invalid_client: 'Google rejected the app credentials. In Render, check that GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET match the same Google OAuth Web application client, then save and redeploy.',
 google_invalid_grant: 'Google rejected this sign-in code. Start a fresh connection from Agent and finish sign-in in the same browser tab. If it repeats, check the Google redirect URI.',
 google_redirect_mismatch: 'The Google redirect URI does not match. Register this site’s /api/auth/google/callback URL in your Google OAuth Web application client.',
 gmail_api_disabled: 'The Gmail API is not enabled for this Google Cloud project. Enable Gmail API in the project that owns your OAuth client, wait a few minutes, then connect again.',
 gmail_access_denied: 'Google sign-in completed, but Gmail denied read access. Enable Gmail API in the OAuth client’s project and approve the read-only email permission. A work account may also need administrator approval.',
 gmail_token_rejected: 'Gmail rejected the authorization token. Please disconnect and start a fresh Google sign-in.',
 gmail_profile_failed: 'Google sign-in completed, but the server could not read your Gmail profile. Please retry; check Render logs for the safe OAuth error code if it repeats.',
 google_token_failed: 'The server could not complete the Google sign-in exchange. Check the matching client ID, client secret, and redirect URI in Google and Render, then retry.',
 google_timeout: 'Google sign-in timed out. Please start a new connection and try again.',
};
export function authMessage(code:string) { return messages[code] || messages.failed; }
