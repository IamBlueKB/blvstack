// HMAC-signed admin session — no DB, no external dep.
// Cookie payload: base64url(JSON({ sub, iat, exp })).hmac
// Verified on every /admin/* request via middleware.

import crypto from 'node:crypto';
import type { AstroCookies } from 'astro';

const COOKIE_NAME = 'blvstack_admin';
const MAX_AGE_S = 60 * 60 * 24 * 7; // 7 days

type SessionPayload = {
  sub: string; // admin email
  iat: number;
  exp: number;
};

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
  // timing-safe compare
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

export function checkPassword(email: string, password: string): boolean {
  const expectedEmail = import.meta.env.ADMIN_EMAIL;
  const expectedPassword = import.meta.env.ADMIN_PASSWORD;
  if (!expectedEmail || !expectedPassword) return false;

  // timing-safe email + password compare (don't leak which one was wrong)
  const eOk = constantEq(email.trim().toLowerCase(), expectedEmail.trim().toLowerCase());
  const pOk = constantEq(password, expectedPassword);
  return eOk && pOk;
}

function constantEq(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) {
    // pad to avoid length leak — still returns false
    const max = Math.max(ba.length, bb.length);
    const pa = Buffer.alloc(max);
    const pb = Buffer.alloc(max);
    ba.copy(pa);
    bb.copy(pb);
    crypto.timingSafeEqual(pa, pb);
    return false;
  }
  return crypto.timingSafeEqual(ba, bb);
}
