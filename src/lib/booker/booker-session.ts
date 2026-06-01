/**
 * BLVBooker staff session helper.
 *
 * Uses the same HMAC + bcrypt approach as src/lib/admin-session.ts (same
 * ADMIN_SESSION_SECRET), with a separate cookie name and a payload that
 * carries the staff id + role. Does not modify admin-session.ts.
 *
 * The founder admin_users session is recognized SEPARATELY in middleware /
 * access.ts and auto-promoted to role='owner' — staff never has a row for
 * the founder.
 */

import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import type { AstroCookies } from 'astro';
import { supabaseAdmin } from '../supabase';
import type { StaffRole } from './types';

const COOKIE_NAME = 'blvbooker_staff';
const MAX_AGE_S = 60 * 60 * 24 * 7; // 7 days
const BCRYPT_ROUNDS = 12;

export interface StaffSessionPayload {
  sub: string; // staff_id
  email: string;
  role: StaffRole;
  iat: number;
  exp: number;
}

// ─── Cookie primitives (parallel to admin-session) ────────────────

function b64url(buf: Buffer | string): string {
  return Buffer.from(buf as any)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function b64urlDecode(s: string): Buffer {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  return Buffer.from(s, 'base64');
}

function secret(): string {
  const s = import.meta.env.ADMIN_SESSION_SECRET;
  if (!s) throw new Error('ADMIN_SESSION_SECRET not set');
  return s;
}

function sign(payload: StaffSessionPayload): string {
  const body = b64url(JSON.stringify(payload));
  const hmac = crypto.createHmac('sha256', secret()).update(body).digest();
  return `${body}.${b64url(hmac)}`;
}

function verify(token: string): StaffSessionPayload | null {
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const expected = b64url(crypto.createHmac('sha256', secret()).update(body).digest());
  if (
    expected.length !== sig.length ||
    !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig))
  ) {
    return null;
  }
  try {
    const payload = JSON.parse(b64urlDecode(body).toString('utf8')) as StaffSessionPayload;
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

// ─── Cookie API ──────────────────────────────────────────────────

export function setStaffSession(
  cookies: AstroCookies,
  staff: { id: string; email: string; role: StaffRole }
): void {
  const now = Math.floor(Date.now() / 1000);
  const token = sign({
    sub: staff.id,
    email: staff.email,
    role: staff.role,
    iat: now,
    exp: now + MAX_AGE_S,
  });
  cookies.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: import.meta.env.PROD,
    sameSite: 'lax',
    path: '/',
    maxAge: MAX_AGE_S,
  });
}

export function clearStaffSession(cookies: AstroCookies): void {
  cookies.delete(COOKIE_NAME, { path: '/' });
}

export function readStaffSession(cookies: AstroCookies): StaffSessionPayload | null {
  const token = cookies.get(COOKIE_NAME)?.value;
  if (!token) return null;
  return verify(token);
}

// ─── Login + admin helpers ───────────────────────────────────────

/** Verify staff login. Returns the staff row (sans hash) on success. */
export async function verifyStaffLogin(
  email: string,
  password: string
): Promise<{ id: string; email: string; role: StaffRole } | null> {
  const normalizedEmail = email.trim().toLowerCase();
  const { data: staff } = await supabaseAdmin
    .from('booker_staff')
    .select('id, email, password_hash, role, active, deleted_at')
    .ilike('email', normalizedEmail)
    .maybeSingle();

  if (!staff || !staff.active || staff.deleted_at) {
    // Run bcrypt anyway to avoid timing leak
    await bcrypt.compare(password, '$2a$12$invalidhashinvalidhashinvalidhashinvalidhashinvalidhash');
    return null;
  }

  const passwordOk = await bcrypt.compare(password, staff.password_hash);
  if (!passwordOk) return null;

  // Bump last_login_at (fire and forget)
  supabaseAdmin
    .from('booker_staff')
    .update({ last_login_at: new Date().toISOString() })
    .eq('id', staff.id)
    .then(() => {});

  return { id: staff.id, email: staff.email, role: staff.role };
}

/** Hash a password for booker_staff inserts/updates. */
export async function hashStaffPassword(password: string): Promise<string> {
  if (password.length < 10) {
    throw new Error('Password must be at least 10 characters');
  }
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}
