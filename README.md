# Dhan Portfolio Dashboard — live, OTP-login, WhatsApp alerts

A Next.js app that:
- Logs you in with mobile OTP (Firebase Phone Auth)
- Pulls your Dhan holdings every 15 minutes via a scheduled job
- Sends a WhatsApp alert when a holding crosses 7% profit (approaching) or 8%
  profit (booking target reached)
- Lets you update your Dhan API credentials from a Settings page, encrypted at rest

Everything below uses **free tiers**: Vercel (hosting), Supabase (database),
Firebase (OTP), and Meta's WhatsApp Cloud API (alerts — the platform is free,
each message costs a fraction of a rupee). You still need to create free
accounts with each of these yourself; I can't create accounts on your behalf.

---

## 1. Firebase (OTP login) — free

1. Go to https://console.firebase.google.com → Create project.
2. Build → Authentication → Sign-in method → enable **Phone**.
3. Project settings → General → add a Web app → copy the config into:
   `NEXT_PUBLIC_FIREBASE_API_KEY`, `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`,
   `NEXT_PUBLIC_FIREBASE_PROJECT_ID`.
4. Project settings → Service accounts → Generate new private key (downloads a
   JSON file). From it, copy `project_id`, `client_email`, `private_key` into
   `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`
   (keep the `\n` characters literal — most hosts handle this fine if you
   paste the whole key as one line in quotes).
5. Authentication → Settings → Authorized domains → add your Vercel domain
   once you have it (step 5 below), or `localhost` while testing.

## 2. Supabase (database) — free

1. https://supabase.com → New project.
2. SQL Editor → paste the contents of `sql/schema.sql` → Run.
3. Project Settings → API → copy `Project URL` and the `service_role` secret
   key into `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`.

## 3. WhatsApp Cloud API (alerts) — free platform, ~₹0.12/alert — OPTIONAL, can skip for now

If you're not ready to deal with Meta's Business Portfolio verification yet,
**skip this whole section** and leave `WHATSAPP_PHONE_NUMBER_ID` /
`WHATSAPP_ACCESS_TOKEN` blank in your `.env`. The app checks for these and
simply won't try to send anything if they're missing — profit-booking
alerts still show up on the dashboard itself, they just won't be pushed to
your phone until you come back and finish this section later.

1. https://developers.facebook.com → create an app → add the **WhatsApp**
   product. This gives you a free test phone number to start.
2. Copy the **Phone Number ID** into `WHATSAPP_PHONE_NUMBER_ID`, and generate
   a permanent access token (System User in Meta Business Settings, not the
   24-hour temporary token) into `WHATSAPP_ACCESS_TOKEN`.
3. WhatsApp Manager → Message Templates → create a template:
   - Name: `profit_alert`
   - Category: **Utility**
   - Body: `{{1}} is up {{2}}% — {{3}}. Check your dashboard to review.`
   - Submit for approval (usually approved within minutes to a few hours).
4. Add the recipient number (yours) as a test recipient while the app is in
   development mode, or complete Business Verification to message any number.

## 4. Dhan API access token

1. Log in to Dhan Web → Profile → **DhanHQ Trading APIs**.
2. Generate an access token (this is what you'll paste into the app's
   Settings page after you deploy — not into `.env`, since it's per-user).
3. Dhan tokens can expire — when Dhan asks you to regenerate, just paste the
   new one into the Settings page in the app.

## 5. Deploy to Vercel — free

1. Push this folder to a GitHub repo.
2. https://vercel.com → New Project → import the repo.
3. Add every variable from `.env.example` (except `WHATSAPP_TEMPLATE_NAME`,
   which already has a default) in Vercel's Environment Variables screen.
4. For `APP_ENCRYPTION_KEY` and `CRON_SECRET`, generate two separate random
   values locally:
   ```
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```
5. Deploy. Visit the URL, you should land on `/login`.

## 6. Schedule the jobs — free

Vercel's free (Hobby) plan only allows daily cron jobs, not every-15-minutes,
so use a free external pinger instead. You'll set up **two** separate jobs:

**Job 1 — refresh holdings every 15 minutes (market hours only)**
1. https://cron-job.org → create a free account.
2. Create a new cron job:
   - URL: `https://YOUR-APP.vercel.app/api/cron/refresh?secret=YOUR_CRON_SECRET`
   - Schedule: every 15 minutes, restricted to roughly 9:00–15:45 IST on
     weekdays (no point pinging outside market hours)
3. Save. Each run fetches holdings for every user with saved credentials,
   updates the dashboard, and fires WhatsApp alerts for new threshold crossings.

**Job 2 — keep your Dhan token alive, every day, all week**
Dhan's personal access tokens expire in ~24 hours. Left alone, you'd have to
manually regenerate and re-paste a new token into Settings every single day.
This job prevents that.
1. In cron-job.org, create a second cron job:
   - URL: `https://YOUR-APP.vercel.app/api/cron/renew-token?secret=YOUR_CRON_SECRET`
   - Schedule: **every 18 hours, every day of the week** (not just market
     hours/weekdays — the token can expire on weekends too if nothing
     renews it)
2. Save. As long as this runs at least once a day without a gap longer than
   ~24h, your Dhan token effectively never expires and you never have to
   touch Settings again — unless Dhan itself forces a reset (e.g. you change
   your Dhan password), in which case you'll need to regenerate manually.

---

## Notes and things to verify yourself

- **Market Quote endpoint**: `lib/dhan.ts` calls Dhan's LTP endpoint using the
  documented pattern, but I couldn't fully confirm the exact response shape
  at build time. Test it with one holding and check the console — adjust the
  field names in `getLtpForHoldings` if Dhan's response differs. Docs:
  https://dhanhq.co/docs/v2/market-quote/
- **Day P&L** is currently calculated as the change since the previous stored
  snapshot, which is a reasonable approximation but not exactly "vs
  yesterday's close." If you want it exact, seed each day's first snapshot
  with the previous close price instead.
- **News and volume/momentum sections** from the earlier demo aren't wired
  into this live version — they'd need a separate news API and a volume
  data source, which we haven't picked yet. The database and layout can take
  them later if you want to add that.
- **WhatsApp template approval**: business-initiated messages (like this
  alert) always require an approved template — free-form messages only work
  within 24 hours of the user messaging you first.
