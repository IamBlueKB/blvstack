import type { APIRoute } from 'astro';
import { supabaseAdmin } from '../../../../../lib/supabase';
import { composeInitialEmail } from '../../../../../lib/outbound/composer';

export const prerender = false;

/**
 * POST /api/admin/prospects/[id]/compose
 * Runs the composer agent to draft a cold email for this prospect.
 */
export const POST: APIRoute = async ({ params }) => {
  const { id } = params;
  if (!id) return j({ error: 'Missing id' }, 400);

  const { data: prospect } = await supabaseAdmin
    .from('prospects')
    .select('*')
    .eq('id', id)
    .single();

  if (!prospect) return j({ error: 'Prospect not found' }, 404);

  try {
    const { subject, body } = await composeInitialEmail({
      contact_name: prospect.contact_name,
      company_name: prospect.company_name,
      company_url: prospect.company_url,
      pain_points: prospect.pain_points,
      ai_research: prospect.ai_research,
    });

    // Save draft
    await supabaseAdmin
      .from('prospects')
      .update({
        draft_subject: subject,
        draft_email: body,
        status: prospect.status === 'new' ? 'composed' : prospect.status,
      })
      .eq('id', id);

    return j({ ok: true, subject, body });
  } catch (err: any) {
    console.error('[compose] Error:', err);
    return j({ error: 'Compose failed', detail: err?.message ?? 'unknown' }, 500);
  }
};

function j(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
