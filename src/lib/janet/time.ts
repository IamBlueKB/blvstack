// Blue's clock. Everything is STORED in UTC (timestamptz) and must be REPORTED
// in his local time — he runs the business from Chicago, so "4:30 PM" has to mean
// 4:30 PM to him, not 4:30 PM UTC.
//
// Converted at the BOUNDARY on purpose, not by the model. Asking JANET to do
// timezone arithmetic on a raw UTC string is exactly the load-bearing model
// belief we removed everywhere else: she'd be right most of the time and silently
// wrong across a DST change. The system does the math; she reads the answer.

export const JANET_TZ = 'America/Chicago';

/** "Jul 21, 2026, 11:31 AM CDT" — a timestamp a human can act on. */
export function formatLocal(iso: string | Date | null | undefined): string {
  if (!iso) return '—';
  const d = iso instanceof Date ? iso : new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleString('en-US', {
    timeZone: JANET_TZ,
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
  });
}

/** "11:31 AM CDT" — when the date is already obvious from context. */
export function formatLocalTime(iso: string | Date | null | undefined): string {
  if (!iso) return '—';
  const d = iso instanceof Date ? iso : new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleString('en-US', { timeZone: JANET_TZ, hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
}

/** Local calendar date, YYYY-MM-DD — "today" means today in Chicago, which is
 *  NOT the UTC date after 7pm local. Anything that buckets by day uses this. */
export function localDateISO(at: Date = new Date()): string {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: JANET_TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(at);
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? '';
  return `${g('year')}-${g('month')}-${g('day')}`;
}

/** Current local wall-clock, for the snapshot header. */
export function nowLocal(): string {
  return formatLocal(new Date());
}

/** Matches a full ISO INSTANT (has a time component). Deliberately does NOT match
 *  a date-only "2026-07-21" — those are calendar dates (session_date, due_date,
 *  review_on) and shifting them by a timezone would be wrong. */
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

/**
 * Deep-walk a tool result and attach a "<field>_local" sibling to every real
 * timestamp. Applied once, centrally, in executeJanetTool — so EVERY tool (and
 * every tool written from here on) reports Blue's clock by construction, instead
 * of each reader being patched one at a time.
 *
 * Additive only: existing fields keep their raw UTC value, so programmatic
 * consumers are unaffected. Date objects (the porsager PSRx driver returns
 * timestamptz as JS Date) are normalized to ISO and get the sibling too.
 */
export function localizeTimestamps<T>(node: T, depth = 0): T {
  if (node == null || depth > 8) return node;
  if (Array.isArray(node)) return node.map((n) => localizeTimestamps(n, depth + 1)) as unknown as T;
  if (node instanceof Date) return node.toISOString() as unknown as T;
  if (typeof node !== 'object') return node;

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
    if (v instanceof Date) {
      out[k] = v.toISOString();
      out[`${k}_local`] = formatLocal(v);
    } else if (typeof v === 'string' && ISO_INSTANT.test(v)) {
      out[k] = v;
      out[`${k}_local`] = formatLocal(v);
    } else {
      out[k] = localizeTimestamps(v, depth + 1);
    }
  }
  return out as unknown as T;
}

/** Calendar day in Blue's zone for an instant — for "made 3d ago"-style lines
 *  where slicing the UTC string would show tomorrow's date after 7pm local. */
export function localDay(iso: string | Date | null | undefined): string {
  if (!iso) return '';
  const d = iso instanceof Date ? iso : new Date(iso);
  return Number.isNaN(d.getTime()) ? String(iso) : localDateISO(d);
}

/** Add a `*_local` sibling for each timestamp field, so anything she reads
 *  already carries the human-readable local time next to the raw UTC value. */
export function withLocalTimes<T extends Record<string, any>>(row: T, fields: string[]): T & Record<string, string> {
  const out: Record<string, any> = { ...row };
  for (const f of fields) if (row[f]) out[`${f}_local`] = formatLocal(row[f]);
  return out as T & Record<string, string>;
}
