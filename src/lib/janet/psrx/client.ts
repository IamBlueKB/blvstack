// JANET Phase 4 — PSRx read-only data connection.
//
// PSRx runs on a SEPARATE Supabase project (brauzztexqtihmwqrrcj). JANET reads it
// through a dedicated Postgres role (janet_readonly) over the Supavisor
// transaction pooler — NOT the service-role key (no god-mode across a project
// boundary into a live patient system). The role has SELECT on operational tables,
// BYPASSRLS to see rows, and exactly ONE write privilege: INSERT on
// janet_lead_drafts (the approval queue). `staff.password` and `app_settings`
// are deliberately NOT granted.
//
// Read-everywhere + write = one INSERT lane (janet_lead_drafts). No UPDATE/DELETE
// anywhere, no writes to any other table. If PSRX_DATABASE_URL is unset the
// connection is unavailable and callers degrade — reads throw a clear error, the
// snapshot omits PSRx. (Exact grants are asserted by the invariants probe.)
//
// Phase 5.3 — psrxSql() returns a FACADE that kills two footguns for all callers,
// present and future, instead of relying on tribal knowledge:
//   1. SERIALIZE — queries run one at a time (a global mutex), so a Promise.all can't
//      fan out and exhaust/deadlock the 3-connection transaction pooler.
//   2. NORMALIZE — timestamptz comes back from the porsager driver as a JS Date, so
//      `row.created_at.slice(...)` throws (it already bit once, silently breaking
//      drafting for every lead with prior messages). The facade coerces Date → ISO
//      string at the boundary, so both `.slice()` and `new Date()` work everywhere.

import postgres from 'postgres';

const ENV: any = (import.meta as any).env ?? {};
const PSRX_DATABASE_URL =
  (ENV.PSRX_DATABASE_URL as string | undefined) || (typeof process !== 'undefined' ? process.env.PSRX_DATABASE_URL : '') || '';

let _raw: ReturnType<typeof postgres> | null = null;

function rawClient(): ReturnType<typeof postgres> {
  if (!PSRX_DATABASE_URL) {
    throw new Error('PSRx is not connected (PSRX_DATABASE_URL not set).');
  }
  if (!_raw) {
    _raw = postgres(PSRX_DATABASE_URL, {
      ssl: 'require',
      prepare: false, // required for the Supavisor transaction pooler (port 6543)
      max: 3,
      idle_timeout: 20,
      connect_timeout: 15,
    });
  }
  return _raw;
}

/** True when a PSRx connection is configured. Callers should check this before
 *  surfacing PSRx state so an unconfigured environment degrades cleanly. */
export function psrxConnected(): boolean {
  return !!PSRX_DATABASE_URL;
}

/** Coerce timestamptz Date objects to ISO strings at the boundary (5.3). Top-level
 *  row fields only — jsonb comes back already string-typed. Pure + testable. */
export function normalizePsrxRows(rows: any): any {
  if (!Array.isArray(rows)) return rows;
  return rows.map((row) => {
    if (row == null || typeof row !== 'object' || Array.isArray(row)) return row;
    const out: any = {};
    for (const k of Object.keys(row)) {
      const v = (row as any)[k];
      out[k] = v instanceof Date ? v.toISOString() : v;
    }
    return out;
  });
}

// Global query mutex (5.3): concurrent psrx queries run ONE AT A TIME so a Promise.all
// can't exhaust/deadlock the pooler. Scope is the serverless invocation — exactly the
// scope where a code path fans queries out.
let _chain: Promise<unknown> = Promise.resolve();

/** Wrap a raw postgres client so every tagged-template query is serialized + its rows
 *  normalized. Advanced/non-template client calls pass straight through. Exported for
 *  the fault-test (inject a stub client). */
export function wrapPsrxClient(raw: any): any {
  return new Proxy(raw, {
    apply(target, thisArg, args) {
      const first = args[0];
      const isTemplate = Array.isArray(first) && Array.isArray((first as any).raw);
      if (!isTemplate) return Reflect.apply(target, thisArg, args); // e.g. sql.unsafe helpers
      const run = _chain.then(() => Reflect.apply(target, thisArg, args));
      _chain = run.catch(() => {}); // keep the mutex alive even if a query fails
      return run.then(normalizePsrxRows);
    },
    get(target, prop, receiver) {
      return Reflect.get(target, prop, receiver);
    },
  });
}

/** The PSRx read-only SQL client — a serialize+normalize FACADE over the raw pooled
 *  client (5.3). Throws if PSRx is not connected — read paths catch and degrade. */
export function psrxSql(): ReturnType<typeof postgres> {
  return wrapPsrxClient(rawClient()) as ReturnType<typeof postgres>;
}
