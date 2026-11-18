# Agent

A voice-first, read-only Gmail assistant for web and iOS. Ask a question, review the transcript, then send. Answers show the supporting email subjects and links. The demo uses three fictional messages; it never accesses your mailbox.

## Run locally

Requires Node 22+.

```sh
npm ci
cp .env.example .env
npm run dev
```

Open http://localhost:5173. The API runs on port 3001. Demo mode works without credentials. `npm test` checks MIME decoding and citation filtering; `npm run build` checks TypeScript and builds the web app. `npm start` serves the built web app and API from port 3001 (set APP_ORIGIN accordingly).

## Connect Gmail

1. Create a Google Cloud project, enable the Gmail API, and configure the OAuth consent screen. During testing, add your Gmail account as a test user.
2. Create a **Web application** OAuth client with redirect URI `http://localhost:3001/api/auth/google/callback`.
3. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and OPENAI_API_KEY in the private `.env` file. Never commit credentials. Restart the server.
4. Click Connect Gmail, review the read-only permission, and authorize. Live answers send up to 20 matching emails to OpenAI when you ask. Agent translates each question into a Gmail search and shows the search used. You can override it under Settings with Gmail search syntax.

Gmail's restricted read-only scope may require Google verification before public distribution. Browser speech recognition uses the browser/device's speech service and may require HTTPS and microphone permission. Typed input is always available. Spoken replies are opt-in.

## iOS

The Capacitor target uses native speech recognition and text-to-speech. Native compilation, signing, and device tests require macOS/Xcode and an Apple developer account. This Linux workspace cannot verify those steps.

```sh
npm run ios:sync
npm run ios:open
```

For a connected iOS build, configure Capacitor `server.url` to your deployed **HTTPS web app** (same origin as the API), then sync. The checked-in configuration uses bundled files for demo mode only. Loading the hosted app keeps Google sign-in in the system web context and avoids putting provider tokens in the native client. Validate Google OAuth on a device: Google may reject authorization inside embedded webviews. Before distribution implement system-browser OAuth with universal links and a one-time server handoff; embedded-webview sign-in is not a production authentication flow.

Set `NSMicrophoneUsageDescription` and `NSSpeechRecognitionUsageDescription` in `ios/App/App/Info.plist` before running voice input. Explain that the microphone transcribes questions about email. These descriptions are supplied in the generated project.

## Current limits and deployment

Each question is independent; follow-up context is not yet supported. Search is generated from your question (or explicitly overridden), limited to 20 messages. Attachments are not processed. Answers can be incomplete or wrong; inspect the sources. Email contents are treated as untrusted model input, but this does not guarantee immunity to prompt injection.

Tokens and session state are stored only in server memory, expire after at most eight hours, and are lost on restart. Google access tokens are not refreshed; reconnect when they expire. Session cookies are HttpOnly, SameSite=Lax, and Secure on HTTPS. Mutation requests validate their Origin. API responses are not cached. Disconnect attempts Google token revocation and always deletes the local session.

Before a public launch: durable encrypted session storage, per-user quotas and abuse protection, account/data deletion policies, Google verification, production OAuth flow for iOS, device testing, and privacy disclosures. Set APP_ORIGIN, PUBLIC_BASE_URL, and GOOGLE_REDIRECT_URI to your HTTPS deployment; allow only the intended host. No email content or credentials are logged by this application.

## Deploy to Render

[Deploy to Render](https://render.com/deploy?repo=https://github.com/janhabuildings/Agent)

1. Sign in to Render, open the link above, and authorize access to `janhabuildings/Agent` if requested. Alternatively choose **New → Blueprint** in Render and select this repository.
2. Review the `agent` web service from `render.yaml` and deploy. The Blueprint selects the Free plan. Render can change plan availability; confirm the displayed plan before creating it.
3. Open the HTTPS `onrender.com` URL Render assigns after the build and health check pass. The fictional demo works immediately without any API keys.
4. For live Gmail, add `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `OPENAI_API_KEY` to the service's private **Environment** settings. Register `https://YOUR-SERVICE.onrender.com/api/auth/google/callback` as an authorized redirect URI in the Google OAuth web client, and add your Gmail address as a test user on the OAuth consent screen.
5. Save and redeploy, then use **Connect Gmail** in the app. Never put secret values in `render.yaml` or commit `.env`.

The server reads Render's `PORT` and binds to `0.0.0.0`. `RENDER_EXTERNAL_URL` supplies the HTTPS origin and OAuth callback automatically. For a custom domain, set both `APP_ORIGIN` and `PUBLIC_BASE_URL` to its HTTPS origin, and update the Google redirect URI. `/api/health` is the deployment health check; `/api/status` reports connection readiness without exposing credentials.

Free services can sleep when idle, so the first request may be slow. A restart, redeploy, or idle shutdown loses the in-memory Gmail session and requires reconnecting. Use one instance until shared session storage is implemented.

## Connect Hostinger email

The app now supports Hostinger mailboxes such as `you@yourcompany.com`, without Google OAuth setup.

1. Open **Connect email → Connect Hostinger email**.
2. Enter your full email address and mailbox password in the HTTPS app. Use a provider-issued app password if your account requires one. Do not share the password in chat or commit it to the repo.
3. After connecting, ask a question in the main chat. `OPENAI_API_KEY` must still be configured in Render for live answers.

The server connects only to `imap.hostinger.com:993` with verified TLS. Login checks the inbox; mailbox credentials stay only in the current server session in memory for at most eight hours. Credentials are not sent to OpenAI, written to application storage, or returned to the client. Disconnect, session expiration, or a server restart removes them. A restart during a request may interrupt an answer. IMAP itself uses your account's credentials, so those credentials can have broader capabilities than Agent; Agent opens the mailbox read-only and has no send/delete operations.

Hostinger search covers **INBOX only**. Automatic search uses one keyword/phrase, or the most recent messages from the last 30 days for broad questions. Each answer reads at most 20 messages and 200 KB of raw source per message; long emails may be truncated. Source cards show an excerpt rather than a Gmail link. Attachments are not analyzed. Gmail search operators do not apply to Hostinger. Voice questions follow the same search limits. The host must permit outbound TLS connections on TCP port 993; a firewall or hosting restriction can prevent login. Sign-in attempts are limited to five per IP per 15 minutes.

### Latest email without AI

For Hostinger, simple requests such as **“What is my last email?”** or **“Read my latest email”** read the newest arrival in INBOX directly, without an OpenAI request or API key. Leave the search scope blank for this shortcut. It reads one message (up to the same size limits), even if the inbox's newest email is older than 30 days. Analytical or filtered questions still use OpenAI. AI failures now identify authentication, API quota, rate limiting, and model-access errors separately from mailbox failures; only fixed error codes are logged.

### Diagnose the deployed AI connection

After signing into email, open **Manage connection → Test AI connection**. This sends one tiny test prompt to the configured model and does not send email data. The result shows a fixed provider error code, upstream HTTP status, the deployment revision, and a SHA-256 key fingerprint. It never returns the key or raw provider messages. A changed fingerprint confirms a different key was loaded after redeployment. Checks are limited to one per session per 30 seconds. An API key's presence alone does not confirm it is valid or usable by the configured model.
