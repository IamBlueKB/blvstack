import type { APIRoute } from 'astro';
import { supabaseAdmin } from '../../../../../../lib/supabase';
import { sendArtistEmail } from '../../../../../../lib/booker/booker-email';
import { requireActor, requireArtistAccess } from '../../../../../../lib/booker/access';

export const prerender = false;

export const POST: APIRoute = async ({ params, url, locals }) => {
  console.log('[send-intake] === START ===');

  let actor;
  try {
    actor = requireActor(locals);
    console.log('[send-intake] actor ok:', actor.role);
  } catch (err: any) {
    console.error('[send-intake] actor check failed:', err?.message);
    return j({ error: 'No actor: ' + (err?.message ?? 'unknown') }, 500);
  }

  const { id } = params;
  if (!id) return j({ error: 'Missing id' }, 400);

  const denied = await requireArtistAccess(actor, id);
  if (denied) {
    console.log('[send-intake] access denied');
    return denied;
  }

  const { data: artist, error: fetchErr } = await supabaseAdmin
    .from('booker_artists')
    .select('*')
    .eq('id', id)
    .single();

  if (fetchErr) {
    console.error('[send-intake] fetch artist failed:', fetchErr.message);
    return j({ error: 'Fetch artist failed: ' + fetchErr.message }, 500);
  }
  if (!artist) return j({ error: 'Artist not found' }, 404);
  if (!artist.email) return j({ error: 'Artist has no email' }, 400);

  console.log('[send-intake] artist ok:', artist.id, artist.email);

  const base =
    (url?.origin && url.origin !== 'undefined' ? url.origin : null) ??
    import.meta.env.SITE ??
    'https://blvstack.com';
  // Use short /i/ redirect for a cleaner URL in emails.
  // Resolves to /booker/intake/<token> server-side.
  const intakeUrl = `${base}/i/${artist.intake_token}`;
  const firstName = artist.stage_name?.split(' ')[0] ?? artist.name?.split(' ')[0] ?? 'there';

  console.log('[send-intake] intake URL:', intakeUrl);

  try {
    console.log('[send-intake] calling sendArtistEmail...');
    const sendResult = await sendArtistEmail({
      to: artist.email,
      subject: `${firstName} — let's get your booking profile set up`,
      eyebrow: '// Roster intake',
      title: `Hey ${firstName} — ready to start booking you.`,
      body: `Quick intake form so I can start pitching you to venues and matching you to gigs that fit. Takes about 5 minutes — covers your style, rates, travel range, and gig types you want.

Once it's in, you'll only hear from me when there's real opportunity on the table. No spam, no fluff.

Link expires in 14 days. Reply if you need a fresh one or have questions before filling it out.`,
      cta: { label: 'Complete intake', url: intakeUrl },
      // The human click IS the approval → mint a manual ref for the gated executor.
      // Key is generation-scoped (intake_sent_at) so a deliberate re-send after the
      // link expires isn't dedup-blocked, while a same-request double-fire dedups.
      approvalRef: `manual:${actor.email}:${id}`,
      idempotencyKey: `booker_intake:${id}:${artist.intake_sent_at ?? 'new'}`,
    });
    console.log('[send-intake] Resend send OK, message id:', sendResult.messageId);

    const now = new Date();
    const expiresAt = new Date(now);
    expiresAt.setDate(expiresAt.getDate() + 14);

    const { error: updateErr } = await supabaseAdmin
      .from('booker_artists')
      .update({
        intake_sent_at: now.toISOString(),
        intake_expires_at: expiresAt.toISOString(),
      })
      .eq('id', id);

    if (updateErr) {
      console.error('[send-intake] update artist row failed:', updateErr.message);
      // Email sent successfully even if update failed — don't roll back, just warn.
      return j({
        ok: true,
        warning: 'Email sent but failed to update artist row: ' + updateErr.message,
        intake_url: intakeUrl,
        message_id: sendResult.messageId,
      });
    }

    console.log('[send-intake] === SUCCESS ===');
    return j({
      ok: true,
      intake_url: intakeUrl,
      expires_at: expiresAt.toISOString(),
      message_id: sendResult.messageId,
    });
  } catch (err: any) {
    console.error('[send-intake] FAILED:', err?.message, err?.stack);
    return j({
      error: err?.message ?? 'Send failed',
      detail: err?.stack?.split('\n').slice(0, 3).join(' | '),
    }, 500);
  }
};

function j(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
