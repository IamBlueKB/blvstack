import type { APIRoute } from 'astro';
import { supabaseAdmin } from '../../../../../../lib/supabase';
import { sendArtistEmail } from '../../../../../../lib/booker/booker-email';
import { requireActor, requireArtistAccess } from '../../../../../../lib/booker/access';

export const prerender = false;

export const POST: APIRoute = async ({ params, url, locals }) => {
  const actor = requireActor(locals);
  const { id } = params;
  if (!id) return j({ error: 'Missing id' }, 400);

  const denied = await requireArtistAccess(actor, id);
  if (denied) return denied;

  const { data: artist } = await supabaseAdmin
    .from('booker_artists')
    .select('*')
    .eq('id', id)
    .single();

  if (!artist) return j({ error: 'Artist not found' }, 404);
  if (!artist.email) return j({ error: 'Artist has no email' }, 400);

  const intakeUrl = `${url.origin}/booker/intake/${artist.intake_token}`;
  const firstName = artist.stage_name?.split(' ')[0] ?? artist.name?.split(' ')[0] ?? 'there';

  try {
    await sendArtistEmail({
      to: artist.email,
      subject: 'Your BLVBooker intake link',
      eyebrow: '// BLVBooker',
      title: `Hey ${firstName} —`,
      body: `Quick form to set up your booking profile. Takes about 5 minutes.

Once you've filled it out, we'll start matching you to gigs and pitching venues that fit.

Link expires never — bookmark it if you want to update your profile later.`,
      cta: { label: 'Complete intake →', url: intakeUrl },
    });

    await supabaseAdmin
      .from('booker_artists')
      .update({ intake_sent_at: new Date().toISOString() })
      .eq('id', id);

    return j({ ok: true, intake_url: intakeUrl });
  } catch (err: any) {
    return j({ error: err?.message ?? 'Send failed' }, 500);
  }
};

function j(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
