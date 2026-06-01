/**
 * BLVBooker RBAC helpers.
 *
 * Roles:
 *   owner   — founder admin_users session OR booker_staff row with role='owner'.
 *             Full access to everything.
 *   manager — full operations, but no staff mgmt / settings / sources / payments.
 *   agent   — scoped to assigned artists; money fields are stripped from responses.
 *
 * IMPORTANT: middleware writes locals.bookerActor for /admin/booker/* and
 * /api/admin/booker/* requests. Use getBookerActor(locals) anywhere downstream.
 */

import type { APIContext } from 'astro';
import { supabaseAdmin } from '../supabase';
import type { BookerActor, StaffRole } from './types';

/**
 * Returns the authenticated BLVBooker actor from Astro locals.
 * Middleware populates locals.bookerActor before any /admin/booker/* request runs.
 * Returns null if absent (should not happen post-middleware — defense in depth).
 */
export function getBookerActor(locals: APIContext['locals']): BookerActor | null {
  return (locals as any).bookerActor ?? null;
}

/** Throws (500) if no actor — call after middleware. */
export function requireActor(locals: APIContext['locals']): BookerActor {
  const actor = getBookerActor(locals);
  if (!actor) throw new Error('No BLVBooker actor on locals — middleware misconfigured');
  return actor;
}

/** Returns true if the actor's role meets or exceeds minRole. */
export function hasRole(actor: BookerActor, minRole: StaffRole): boolean {
  const rank: Record<StaffRole, number> = { agent: 1, manager: 2, owner: 3 };
  return rank[actor.role] >= rank[minRole];
}

/** Returns a 403 Response if actor lacks the role; else null (continue). */
export function requireRole(actor: BookerActor | null, minRole: StaffRole): Response | null {
  if (!actor) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  if (!hasRole(actor, minRole)) {
    return new Response(JSON.stringify({ error: 'Forbidden' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  return null;
}

/**
 * For agent actors, returns the artist_ids they're assigned to.
 * Owners + managers always return null (= unconstrained).
 */
export async function assignedArtistIds(actor: BookerActor): Promise<string[] | null> {
  if (actor.role !== 'agent') return null;
  if (!actor.staffId) return []; // agent with no staffId shouldn't exist; safe-deny

  const { data } = await supabaseAdmin
    .from('booker_staff_assignments')
    .select('artist_id')
    .eq('staff_id', actor.staffId);

  return (data ?? []).map((r: any) => r.artist_id);
}

/**
 * Check whether a specific artist is accessible by the actor.
 * Owners/managers always true. Agents only if assigned.
 */
export async function canAccessArtist(actor: BookerActor, artistId: string): Promise<boolean> {
  if (actor.role !== 'agent') return true;
  const ids = await assignedArtistIds(actor);
  return (ids ?? []).includes(artistId);
}

// ─── Money stripping ──────────────────────────────────────────────

const MONEY_FIELDS_ARTIST = ['monthly_rate', 'success_fee_pct'];
const MONEY_FIELDS_MATCH = ['booked_amount'];
const MONEY_FIELDS_GIG = ['pay_text', 'pay_amount'];

/**
 * Recursively strip money fields from a payload for agent actors.
 * Owners + managers pass through unchanged.
 *
 * Strips:
 *   - top-level money fields (booked_amount, monthly_rate, success_fee_pct, pay_text, pay_amount)
 *   - same fields on nested .artist / .gig / .venue / .match
 *   - removes any 'payment' / 'payments' arrays/objects entirely
 *
 * Pass `entity` to hint what shape the top level is. Default behavior strips
 * everything money-related it recognizes.
 */
export function stripMoney<T>(actor: BookerActor, payload: T): T {
  if (actor.role !== 'agent') return payload;
  return stripMoneyRecursive(payload, 0) as T;
}

function stripMoneyRecursive(value: any, depth: number): any {
  if (depth > 6) return value; // safety
  if (value == null) return value;
  if (Array.isArray(value)) return value.map((v) => stripMoneyRecursive(v, depth + 1));
  if (typeof value !== 'object') return value;

  const out: any = {};
  for (const [k, v] of Object.entries(value)) {
    // Drop entire payment objects/arrays
    if (k === 'payments' || k === 'payment') continue;
    // Drop known money keys
    if (
      MONEY_FIELDS_ARTIST.includes(k) ||
      MONEY_FIELDS_MATCH.includes(k) ||
      MONEY_FIELDS_GIG.includes(k)
    ) {
      continue;
    }
    out[k] = stripMoneyRecursive(v, depth + 1);
  }
  return out;
}

/**
 * Convenience: 403 if actor cannot access this artist.
 */
export async function requireArtistAccess(
  actor: BookerActor,
  artistId: string
): Promise<Response | null> {
  const ok = await canAccessArtist(actor, artistId);
  if (!ok) {
    return new Response(JSON.stringify({ error: 'Forbidden' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  return null;
}
