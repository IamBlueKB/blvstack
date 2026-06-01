# Cloudflare Email Workers

This folder holds Cloudflare Email Worker scripts. They're not Astro pages — they're standalone scripts deployed to Cloudflare's edge.

## booker-inbound-worker.js

Catches replies sent to `blvbooker@tryblvstack.com`, parses them, and POSTs to `/api/webhooks/booker-reply` so the reply is matched to a prospect/match in Supabase. Also forwards the email to your Gmail.

### Deploy steps (one-time)

1. **Cloudflare → tryblvstack.com → Workers & Pages → Create**.
2. Choose **Worker** template. Name it `booker-inbound`. Paste the contents of `booker-inbound-worker.js`. **Save & Deploy**.
3. Worker settings → **Variables** tab → add (as plain text, NOT secrets — the worker reads env directly):
   - `WEBHOOK_URL` = `https://blvstack.com/api/webhooks/booker-reply`
   - `WEBHOOK_SECRET` = (whatever you set as `BOOKER_WEBHOOK_SECRET` in Vercel; can be any random string)
   - `FORWARD_TO` = `blue@blvstack.com`
4. Worker → **Settings → Triggers → Add → Email handler** (or set up a Custom Email Address binding).
5. **Cloudflare → tryblvstack.com → Email → Email Workers** → bind this worker to the address `blvbooker@tryblvstack.com`.
6. **DELETE the previous simple "forward to blue@blvstack.com" routing rule** for `blvbooker@tryblvstack.com` — the worker now handles forwarding too. (Leave the simple rule for `blue@tryblvstack.com` alone; that's the cold-outbound sender, not booker.)

### Worker dependency

The worker imports `postal-mime` for parsing. Cloudflare Workers supports npm imports via `wrangler` or via the dashboard's built-in editor (it bundles automatically). If the dashboard editor balks at the import, deploy via Wrangler:

```bash
npm install -g wrangler
wrangler login
mkdir booker-inbound && cd booker-inbound
npm init -y
npm install postal-mime
# Copy booker-inbound-worker.js into src/index.js
# Create wrangler.toml:
#   name = "booker-inbound"
#   main = "src/index.js"
#   compatibility_date = "2026-01-01"
#   [vars]
#   WEBHOOK_URL = "https://blvstack.com/api/webhooks/booker-reply"
#   WEBHOOK_SECRET = "..."
#   FORWARD_TO = "blue@blvstack.com"
wrangler deploy
```

### After deploy

- Send a test email to `blvbooker@tryblvstack.com` (or have someone reply to a booker pitch).
- Check the worker logs in Cloudflare for the webhook POST.
- Check `booker_outreach` table for `status='replied'` rows and matching `booker_matches` flipping to `interested` (or `suppressed` on stop replies).
