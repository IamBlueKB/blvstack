// Search across a record's contact details — shared by JANET's client/contact tools.
// A phone-like query (digits plus phone punctuation, 4+ digits) matches numbers in any format:
// "5106100763", "(510) 610-0763" and "+1 510 610 0763" all find "510-610-0763". Anything else is a
// case-insensitive substring over every field given; objects (e.g. socials) are searched by their values.
// The admin list pages mirror this rule in their inline filter scripts.

const digitsOf = (s: string) => s.replace(/\D/g, '');

export function matchesSearch(fields: unknown[], query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const texts = fields.flatMap((f) =>
    f == null ? [] : typeof f === 'object' ? Object.values(f as Record<string, unknown>).filter((v) => v != null).map(String) : [String(f)],
  );
  const qd = digitsOf(q);
  const phoneLike = qd.length >= 4 && /^[\d\s().+-]+$/.test(q);
  if (phoneLike) {
    const wanted = qd.length === 11 && qd.startsWith('1') ? [qd, qd.slice(1)] : [qd];
    if (texts.some((t) => { const d = digitsOf(t); return d.length >= 4 && wanted.some((w) => d.includes(w)); })) return true;
  }
  return texts.some((t) => t.toLowerCase().includes(q));
}
