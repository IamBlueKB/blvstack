import type { APIRoute } from 'astro';
import { supabaseAdmin } from '../../../../../lib/supabase';
import { researchProspect } from '../../../../../lib/outbound/researcher';

export const prerender = false;

/**
 * POST /api/admin/prospects/[id]/research
 * Fetches the prospect's company website and runs the researcher agent.
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
  if (!prospect.company_url) return j({ error: 'No company URL to research' }, 400);

  try {
    // Fetch the company website
    const res = await fetch(prospect.company_url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; BLVSTACK-Bot/1.0)',
        Accept: 'text/html,application/xhtml+xml',
      },
      redirect: 'follow',
    });

    if (!res.ok) {
      return j({ error: `Could not fetch ${prospect.company_url}: HTTP ${res.status}` }, 502);
    }

    const html = await res.text();
    const textContent = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    // Run researcher agent
    const research = await researchProspect(
      prospect.company_name ?? 'Unknown',
      prospect.company_url,
      textContent
    );

    // Update prospect with research data
    const painPointsSummary = research.pain_points
      .map((p) => `${p.problem} → ${p.blvstack_solution} (${p.tier}, ${p.confidence})`)
      .join('\n');

    // If researcher found emails/contacts, update those too
    const updates: Record<string, unknown> = {
      ai_research: research,
      pain_points: painPointsSummary,
      status: 'researched',
    };

    if (!prospect.contact_email && research.contact_hints.emails_found?.length > 0) {
      updates.contact_email = research.contact_hints.emails_found[0];
    }
    if (!prospect.contact_name && research.contact_hints.team_members?.length > 0) {
      updates.contact_name = research.contact_hints.team_members[0];
    }

    await supabaseAdmin.from('prospects').update(updates).eq('id', id);

    return j({ ok: true, research });
  } catch (err: any) {
    console.error('[research] Error:', err);
    return j({ error: 'Research failed', detail: err?.message ?? 'unknown' }, 500);
  }
};

function j(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
