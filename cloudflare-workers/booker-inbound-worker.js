/**
 * Cloudflare Email Worker — BLVBooker inbound reply forwarder
 * --------------------------------------------------------------
 * Catches every email sent to blvbooker@tryblvstack.com, parses
 * sender + subject + body, POSTs to BLVSTACK's inbound webhook so
 * the reply gets matched to the right prospect/match in Supabase.
 * It also forwards the email to your Gmail so you still see it.
 *
 * DEPLOY (one-time setup):
 *
 * 1. In Cloudflare → tryblvstack.com → Workers & Pages → Create
 *    Worker. Paste this file. Save & Deploy.
 *
 * 2. In the Worker settings → Variables → add:
 *      WEBHOOK_URL   = https://blvstack.com/api/webhooks/booker-reply
 *      WEBHOOK_SECRET = (the value you set as BOOKER_WEBHOOK_SECRET in Vercel)
 *      FORWARD_TO    = blue@blvstack.com
 *
 * 3. In Cloudflare → tryblvstack.com → Email → Email Workers →
 *    bind this Worker to the address `blvbooker@tryblvstack.com`.
 *
 * 4. (Recommended) DELETE the previous "blvbooker@tryblvstack.com →
 *    forward to blue@blvstack.com" simple routing rule, since this
 *    Worker now handles both the webhook AND the forward.
 */

import PostalMime from 'postal-mime';

export default {
  async email(message, env, ctx) {
    // 1. Parse the incoming email
    let parsed;
    try {
      parsed = await PostalMime.parse(message.raw);
    } catch (err) {
      console.error('[booker-worker] parse failed:', err);
      // Fall through to forward anyway
    }

    const from = parsed?.from?.address ?? message.from ?? '';
    const subject = parsed?.subject ?? message.headers.get('subject') ?? '';
    const body = parsed?.text ?? parsed?.html?.replace(/<[^>]+>/g, ' ') ?? '';

    // 2. POST to BLVSTACK webhook (best-effort, don't block forward)
    if (env.WEBHOOK_URL) {
      ctx.waitUntil(
        fetch(env.WEBHOOK_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from,
            subject,
            body,
            secret: env.WEBHOOK_SECRET ?? '',
          }),
        }).catch((err) => {
          console.error('[booker-worker] webhook POST failed:', err);
        })
      );
    }

    // 3. Forward the email to Gmail so it's still visible to the operator
    if (env.FORWARD_TO) {
      try {
        await message.forward(env.FORWARD_TO);
      } catch (err) {
        console.error('[booker-worker] forward failed:', err);
      }
    }
  },
};
