# Background scheduling setup

Agent's Schedules page accepts a task in natural language or voice, previews a recurring schedule, and requires review plus explicit consent before saving credentials. Results are delivered inside Agent. Sending emails or changing CRM records is not implemented.

The existing Free Render web service can keep serving the app. Timers in a sleeping web service are not a reliable scheduler. Background work needs a persistent Postgres database plus a Render Cron Job or a continuously running worker. These services can carry charges; review Render's displayed plans before creating anything. No paid resources are created by a code push.

## One-time Render setup

1. Create a **persistent PostgreSQL database** in Render, in the same region as Agent. Use a dedicated database, not the CRM database. Trial databases can expire. Copy its internal connection URL to the existing Agent web service as `DATABASE_URL`. For an external database use its TLS connection URL and keep certificate verification enabled.
2. Set `SCHEDULE_ENCRYPTION_KEY` on Agent to a dedicated high-entropy secret of at least 32 characters. The updated main Blueprint can generate this value with `generateValue: true`; if you already manage the service manually, generate a random value using your password manager or `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` locally. Keep it private and do not paste it into chat. **Keep this value unchanged across deployments. Losing or replacing it makes saved schedules, account mappings, credentials and results unreadable.** Do not reuse the OpenAI API key as the encryption key.
3. Create **New → Cron Job** from `janhabuildings/Agent`, branch `main`:
   - Runtime: Node 22
   - Cron schedule: `* * * * *` (the runner checks every minute; each user's timezone is stored in their task)
   - Build: `npm ci --omit=dev`
   - Command: `npm run schedules:tick`
   - Environment: copy the **same** `DATABASE_URL`, `SCHEDULE_ENCRYPTION_KEY` and `OPENAI_API_KEY` from the web service. Copy `OPENAI_MODEL` if set. For Gmail schedules also copy `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`. Hostinger and CRM do not need those Google variables.
   - `render.scheduler.yaml` is an optional Blueprint template for this new Cron service; it does not create the database or replace the existing web service. Supply the private environment values in Render.
4. Redeploy the web service. Run the Cron job once manually, or wait for its first successful scheduled check. The Schedules page should show **Background runner online**. A recent heartbeat is required before activating, resuming, or running a task now. Until then tasks can only be previewed or saved paused if the database is ready.
5. In Agent, reconnect email/CRM if needed, open **Schedules**, write a task with its timing, preview it, review the next three run times and sources, approve encrypted storage, and activate. Use **Run now → Run history** to verify a real report.

For a continuously running worker, use `npm run schedules:work` with the same environment instead of Cron. It polls every 30 seconds. Use one worker initially. Global PostgreSQL advisory locking prevents overlapping runner replicas from processing the same due batch. Shared per-account locks synchronize rotating CRM refresh tokens between live queries and background runs.

## User flow and supported tasks

Examples:

- "Every weekday at 8 AM, summarize urgent contractor emails and upcoming CRM task deadlines."
- "Every Friday at 4 PM, report on overdue CRM tasks."
- "At 9 AM daily, review unpaid invoices and prepare a report." (CRM administrator permission applies.)

Tasks are free text, not a fixed task list. AI interprets the task but cannot execute arbitrary code, send email, change records or browse arbitrary websites. Unsupported actions or missing timing should produce an explanation for the user. The scheduled runtime has only read/report operations. Every run replans bounded retrieval and executes a report using the selected sources.

Recurring five-field cron expressions and IANA timezones are supported, with a minimum interval of 15 minutes. One-time tasks and patterns that require multiple independent cron expressions are not supported in this version. Each schedule is bound to the sources reviewed at creation; create a new schedule to change sources. Existing tasks and timing can be edited. Each question/report uses existing email/CRM retrieval limits. Attachment text can be included when explicitly requested; scans still need OCR. Files are not automatically downloaded to a user's device.

Reports appear in **Run history** and can be read aloud. Delivery is inside Agent only. Run now queues one report without resuming a paused recurrence. Pause cancels future queued work. A read already in progress may finish. The next occurrence is calculated after a run completes, so runs do not overlap or produce a backlog burst after downtime. A missed schedule is checked on the next worker tick; exact start times are not guaranteed.

## Data lifecycle and security

Schedules and reports are account-private. Ownership is derived from verified CRM user IDs or verified mailbox identities and HMAC-hashed before storage. Sign in using the same connected accounts to find saved schedules after a restart. Sources stay separate in the live chat; background reports can combine email plus one CRM collection when reviewed.

Task contents, saved connection grants and report contents are AES-256-GCM encrypted at rest with per-owner/per-record authenticated context. The app never returns stored passwords or provider tokens. SQL uses parameters and account ownership checks. The worker loads saved connections; credentials never go to OpenAI. Mail/CRM data needed for a report goes to OpenAI when the run executes. Workers respect existing read-only operations and user permissions. Default limits remain 20 emails, up to 50 CRM records from one collection, and bounded attachment text; the answer must disclose incomplete coverage.

Live sessions remain temporary. Background access persists only after consent: Hostinger stores encrypted mailbox credentials; CRM stores encrypted access/refresh tokens; Gmail stores encrypted offline access/refresh tokens. Reconnect Gmail once after this deployment if it was authorized without offline access. Provider revocation, changed passwords or account policy can stop runs; refresh saved connections in Schedules after reconnecting. Refreshing applies to that owner's other tasks using the same account. It cannot silently replace a saved grant with a different account.

Disconnecting email or CRM pauses affected schedules and removes the saved grant. Deleting the last schedule for an owner removes that owner's saved connection vault. Pausing alone retains encrypted grants and history; a running read may finish. Expiring or closing a live app session does not cancel approved background work. Each task retains at most 30 run results. Deleting a schedule also deletes its run history.

The worker leases due jobs and stores one logical run per schedule/due time. An interrupted run may be retried after its lease expires; reads/AI calls can be repeated, but only one logical report entry is retained. There is no exactly-once guarantee for upstream API usage. Credentials refreshed during a report are saved back with version checks so newer user updates are not overwritten. If the key or database is unavailable, the worker fails safely instead of using plaintext storage or a web timer.

## Verification

`npm test` includes encryption/tampering tests, timezone/DST tests, free-text interpretation and unsupported-task tests, account isolation, HTTP consent/draft ownership, and background report tests with mocked email/CRM/AI. Embedded PostgreSQL tests exercise the actual schema, saved grants, leases, manual paused runs, interrupted-run recovery, run history and revocation. A production Render database and live scheduled execution still require deployment verification.

## Diagnose a failed Render Cron run

The message `.env not found. Continuing without it.` is normal on Render: service environment variables are used instead of a committed `.env` file.

The worker logs a safe JSON diagnostic such as `database_auth_failed`, `database_hostname_unresolved`, `database_permission_denied`, or `encryption_key_mismatch`, plus the stage of the failure. It never logs raw database error objects, connection URLs, credentials or provider responses. Share that diagnostic code/stage to troubleshoot. A key mismatch requires restoring the original key, not generating a replacement or clearing database tables.
