import type { APIRoute } from 'astro';
import { supabaseAdmin } from '../../../../lib/supabase';
import { scrapeUrl } from '../../../../lib/outbound/scraper';

export const prerender = false;

/**
 * POST /api/admin/prospects/scrape
 * Body: { urls: string[] }
 * Fetches each URL, runs scraper agent, inserts extracted prospects.
 */
export const POST: APIRoute = async ({ request }) => {
  let body: { urls?: string[]; maxPerUrl?: number };
  try {
    body = await request.json();
  } catch {
    return j({ error: 'Invalid JSON' }, 400);
  }

  const urls = body.urls;
  const maxPerUrl = Math.min(Math.max(body.maxPerUrl ?? 20, 1), 100);
  if (!urls || !Array.isArray(urls) || urls.length === 0) {
    return j({ error: 'Provide at least one URL' }, 400);
  }

  if (urls.length > 10) {
    return j({ error: 'Max 10 URLs per batch' }, 400);
  }

  const results: { url: string; found: number; error?: string }[] = [];

  for (const url of urls) {
    try {
      // Fetch the page content
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; BLVSTACK-Bot/1.0)',
          Accept: 'text/html,application/xhtml+xml',
        },
        redirect: 'follow',
      });

      if (!res.ok) {
        results.push({ url, found: 0, error: `HTTP ${res.status}` });
        continue;
      }

      const html = await res.text();

      // Strip HTML tags for cleaner extraction
      const textContent = html
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

      // Find companies already extracted from this URL in previous runs
      const { data: alreadyExtractedRows } = await supabaseAdmin
        .from('prospects')
        .select('company_name')
        .eq('source_url', url)
        .not('company_name', 'is', null);
      const alreadyExtracted = (alreadyExtractedRows ?? [])
        .map((r: any) => r.company_name)
        .filter(Boolean);

      // Run scraper agent
      const prospects = await scrapeUrl(url, textContent, maxPerUrl, alreadyExtracted);

      if (prospects.length === 0) {
        results.push({ url, found: 0 });
        continue;
      }

      // Check suppression list
      const emails = prospects.map((p) => p.contact_email).filter(Boolean) as string[];
      let suppressed = new Set<string>();
      if (emails.length > 0) {
        const { data: suppressedRows } = await supabaseAdmin
          .from('suppression_list')
          .select('email')
          .in('email', emails);
        suppressed = new Set((suppressedRows ?? []).map((r: any) => r.email));
      }

      // Check for duplicates by company_url
      const companyUrls = prospects.map((p) => p.company_url).filter(Boolean) as string[];
      let existingUrls = new Set<string>();
      if (companyUrls.length > 0) {
        const { data: existingRows } = await supabaseAdmin
          .from('prospects')
          .select('company_url')
          .in('company_url', companyUrls);
        existingUrls = new Set((existingRows ?? []).map((r: any) => r.company_url));
      }

      const rows = prospects
        .filter((p) => {
          if (p.contact_email && suppressed.has(p.contact_email)) return false;
          if (p.company_url && existingUrls.has(p.company_url)) return false;
          return true;
        })
        .map((p) => ({
          source_url: url,
          company_name: p.company_name,
          company_url: p.company_url,
          contact_name: p.contact_name,
          contact_email: p.contact_email,
          notes: p.context,
          status: 'new',
        }));

      if (rows.length > 0) {
        await supabaseAdmin.from('prospects').insert(rows);
      }

      results.push({ url, found: rows.length });
    } catch (err: any) {
      console.error(`[scrape] Error processing ${url}:`, err);
      results.push({ url, found: 0, error: err?.message ?? 'Unknown error' });
    }
  }

  const totalFound = results.reduce((sum, r) => sum + r.found, 0);
  return j({ ok: true, total_found: totalFound, results });
};

function j(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
