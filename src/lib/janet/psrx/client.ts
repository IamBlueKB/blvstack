// JANET Phase 4 — PSRx read-only data connection.
//
// PSRx runs on a SEPARATE Supabase project (brauzztexqtihmwqrrcj). JANET reads it
// through a dedicated read-only Postgres role (janet_readonly) over the Supavisor
// transaction pooler — NOT the service-role key (no god-mode across a project
// boundary into a live patient system). The role has SELECT on operational tables
// only, BYPASSRLS to see rows, and cannot write. `staff.password` and `app_settings`
// are deliberately NOT granted.
//
// Everything here is READ-ONLY by construction (the role has no write privilege).
// If PSRX_DATABASE_URL is unset the connection is simply unavailable and callers
// degrade — reads throw a clear error, the snapshot omits PSRx.

import postgres from 'postgres';

const PSRX_DATABASE_URL =
  (import.meta.env.PSRX_DATABASE_URL as string | undefined) || process.env.PSRX_DATABASE_URL || '';

let _sql: ReturnType<typeof postgres> | null = null;

/** True when a PSRx connection is configured. Callers should check this before
 *  surfacing PSRx state so an unconfigured environment degrades cleanly. */
export function psrxConnected(): boolean {
  return !!PSRX_DATABASE_URL;
}

/** The PSRx read-only SQL client (lazy singleton, reused across warm invocations).
 *  Throws if PSRx is not connected — read paths catch and degrade. */
export function psrxSql(): ReturnType<typeof postgres> {
  if (!PSRX_DATABASE_URL) {
    throw new Error('PSRx is not connected (PSRX_DATABASE_URL not set).');
  }
  if (!_sql) {
    _sql = postgres(PSRX_DATABASE_URL, {
      ssl: 'require',
      prepare: false, // required for the Supavisor transaction pooler (port 6543)
      max: 3,
      idle_timeout: 20,
      connect_timeout: 15,
    });
  }
  return _sql;
}
