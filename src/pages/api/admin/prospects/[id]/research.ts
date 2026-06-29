import type { APIRoute } from 'astro';
import { supabaseAdmin } from '../../../../../lib/supabase';
import { researchProspect, detectNiche } from '../../../../../lib/outbound/researcher';

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
    // Fetch homepage + a small set of contact-relevant subpages in parallel.
    // Single-page scrapes miss emails that live on /contact pages (the most
    // common location). Booker's researcher does 21 subpages for venues; for
    // prospect outreach 5 is plenty and keeps latency + Claude tokens manageable.
    const SUBPAGES = ['/contact', '/contact-us', '/about', '/team'];
    const base = new URL(prospect.company_url);
    const urls = [base.toString(), ...SUBPAGES.map((p) => new URL(p, base).toString())];

    const fetched = await Promise.allSettled(
      urls.map((u) =>
        fetch(u, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; BLVSTACK-Bot/1.0)',
            Accept: 'text/html,application/xhtml+xml',
          },
          redirect: 'follow',
          signal: AbortSignal.timeout(8000),
        }),
      ),
    );

    const stripHtml = (html: string) =>
      html
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    const PER_PAGE_CAP = 6000; // 5 pages * 6k = 30k total, fits Claude budget
    let textContent = '';
    let pagesFetched = 0;
    for (let i = 0; i < fetched.length; i++) {
      const r = fetched[i];
      if (r.status !== 'fulfilled' || !r.value.ok) continue;
      const html = await r.value.text();
      const text = stripHtml(html);
      if (!text) continue;
      textContent += `\n\n--- ${urls[i]} ---\n${text.slice(0, PER_PAGE_CAP)}`;
      pagesFetched++;
    }

    if (pagesFetched === 0) {
      return j({ error: `Could not fetch any pages from ${prospect.company_url}` }, 502);
    }

    // Auto-detect niche BEFORE running the researcher so the research prompt
    // can be niche-aware on the first pass. Never overwrite a manually-set niche —
    // only fill in when prospect.niche is currently null.
    let nicheForResearch: string | null = prospect.niche ?? null;
    let autoDetectedNiche: string | null = null;
    if (!nicheForResearch) {
      autoDetectedNiche = detectNiche(textContent, prospect.company_url);
      nicheForResearch = autoDetectedNiche;
    }

    // Run researcher agent (niche-aware when nicheForResearch is a live niche)
    const research = await researchProspect(
      prospect.company_name ?? 'Unknown',
      prospect.company_url,
      textContent,
      { niche: nicheForResearch }
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
      // Researcher is authoritative for disqualification — re-running re-evaluates.
      // Setting to false explicitly clears the flag if a previously-disqualified
      // prospect no longer matches signals (e.g. site copy changed).
      disqualified: research.disqualified === true,
      disqualified_reason: research.disqualified === true ? (research.disqualified_reason ?? null) : null,
    };

    // Save auto-detected niche ONLY when prospect.niche was null.
    // Manual classifications via PUT /api/admin/prospects/[id] are never overwritten.
    if (!prospect.niche && autoDetectedNiche) {
      updates.niche = autoDetectedNiche;
    }

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
