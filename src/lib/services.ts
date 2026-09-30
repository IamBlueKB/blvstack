// The five services, keyed by the slug used in /services#<slug> and /start?service=<slug>.
// Browser-safe: the Start form imports it.

export const SERVICE_LABELS: Record<string, string> = {
  sites: 'Custom Websites',
  leads: 'Lead Capture & Booking',
  care: 'Follow-Up & Monthly Care',
  ai: 'AI & Automation',
  it: 'IT & Infrastructure',
};

// Links from before the 2026-09 reskin still carry the old slugs.
const LEGACY: Record<string, string> = { agents: 'ai', systems: 'ai', interfaces: 'sites' };

/** A readable name for a ?service= value, or null if it isn't one of ours. */
export function serviceLabel(slug: string | null | undefined): string | null {
  if (!slug) return null;
  return SERVICE_LABELS[slug] ?? SERVICE_LABELS[LEGACY[slug]] ?? null;
}
