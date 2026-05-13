// HMAC-signed admin session + DB-backed credentials.
// First login auto-seeds the admin_users row from ADMIN_EMAIL / ADMIN_PASSWORD env vars.
// After seeding, password changes happen at runtime via /admin/settings.

import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import type { AstroCookies } from 'astro';
import { supabaseAdmin } from './supabase';

const COOKIE_NAME = 'blvstack_admin';
const MAX_AGE_S = 60 * 60 * 24 * 7; // 7 days
const BCRYPT_ROUNDS = 12;

type SessionPayload = {
  sub: string; // admin email
  iat: number;
  exp: number;
};

// ─── Cookie helpers ───────────────────────────────────────────────

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

function sign(payload: SessionPayload): string {
  const body = b64url(JSON.stringify(payload));
  const hmac = crypto.createHmac('sha256', secret()).update(body).digest();
  return `${body}.${b64url(hmac)}`;
}

function verify(token: string): SessionPayload | null {
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
    const payload = JSON.parse(b64urlDecode(body).toString('utf8')) as SessionPayload;
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

export function setAdminSession(cookies: AstroCookies, email: string): void {
  const now = Math.floor(Date.now() / 1000);
  const token = sign({ sub: email, iat: now, exp: now + MAX_AGE_S });
  cookies.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: import.meta.env.PROD,
    sameSite: 'lax',
    path: '/',
    maxAge: MAX_AGE_S,
  });
}

export function clearAdminSession(cookies: AstroCookies): void {
  cookies.delete(COOKIE_NAME, { path: '/' });
}

export function readAdminSession(cookies: AstroCookies): SessionPayload | null {
  const token = cookies.get(COOKIE_NAME)?.value;
  if (!token) return null;
  return verify(token);
}

// ─── DB-backed credentials ─────────────────────────────────────────

/** Get the admin user row, seeding from env vars on first call. */
async function ensureAdminUser(): Promise<{ email: string; password_hash: string } | null> {
  const { data: existing } = await supabaseAdmin
    .from('admin_users')
    .select('email, password_hash')
    .limit(1)
    .maybeSingle();

  if (existing) return existing;

  // Seed from env vars
  const envEmail = import.meta.env.ADMIN_EMAIL?.trim().toLowerCase();
  const envPassword = import.meta.env.ADMIN_PASSWORD;
  if (!envEmail || !envPassword) return null;

  const hash = await bcrypt.hash(envPassword, BCRYPT_ROUNDS);
  const { data: seeded } = await supabaseAdmin
    .from('admin_users')
    .insert({ email: envEmail, password_hash: hash })
    .select('email, password_hash')
    .single();

  return seeded ?? null;
}

/** Verify a login attempt. Returns the normalized email on success, null on failure. */
export async function verifyLogin(email: string, password: string): Promise<string | null> {
  const user = await ensureAdminUser();
  if (!user) return null;

  const emailOk = email.trim().toLowerCase() === user.email.trim().toLowerCase();
  const passwordOk = await bcrypt.compare(password, user.password_hash);

  // Always run both checks even if email fails (avoid timing leak)
  if (!emailOk || !passwordOk) return null;
  return user.email;
}

/** Change the admin password. Requires current password. */
export async function changePassword(
  currentPassword: string,
  newPassword: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await ensureAdminUser();
  if (!user) return { ok: false, error: 'No admin user' };

  const valid = await bcrypt.compare(currentPassword, user.password_hash);
  if (!valid) return { ok: false, error: 'Current password incorrect' };

  if (newPassword.length < 10) {
    return { ok: false, error: 'New password must be at least 10 characters' };
  }

  const newHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
  const { error } = await supabaseAdmin
    .from('admin_users')
    .update({ password_hash: newHash, updated_at: new Date().toISOString() })
    .eq('email', user.email);

  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/** Set password directly (used by reset flow — no current-password check). */
export async function setPasswordDirect(
  email: string,
  newPassword: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (newPassword.length < 10) {
    return { ok: false, error: 'Password must be at least 10 characters' };
  }
  const newHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
  const { error } = await supabaseAdmin
    .from('admin_users')
    .update({ password_hash: newHash, updated_at: new Date().toISOString() })
    .eq('email', email.trim().toLowerCase());
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function getAdminEmail(): Promise<string | null> {
  const user = await ensureAdminUser();
  return user?.email ?? null;
}

// ─── Reset tokens ──────────────────────────────────────────────────

export async function createResetToken(email: string): Promise<string | null> {
  const user = await ensureAdminUser();
  if (!user) return null;
  if (email.trim().toLowerCase() !== user.email.trim().toLowerCase()) return null;

  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString(); // 30 min

  const { error } = await supabaseAdmin.from('admin_reset_tokens').insert({
    token,
    email: user.email,
    expires_at: expiresAt,
  });
  if (error) return null;
  return token;
}

export async function consumeResetToken(token: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from('admin_reset_tokens')
    .select('email, expires_at, used_at')
    .eq('token', token)
    .maybeSingle();

  if (!data) return null;
  if (data.used_at) return null;
  if (new Date(data.expires_at).getTime() < Date.now()) return null;

  await supabaseAdmin
    .from('admin_reset_tokens')
    .update({ used_at: new Date().toISOString() })
    .eq('token', token);

  return data.email;
}
