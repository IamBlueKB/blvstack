import { defineMiddleware } from 'astro:middleware';
import { readAdminSession } from './lib/admin-session';
import { readStaffSession } from './lib/booker/booker-session';

// Gate every /admin/* page on a valid session cookie.
// /admin/login + /api/admin/login are open. Everything else redirects.

const PUBLIC_ADMIN_PATHS = new Set<string>([
  '/admin/login',
  '/admin/forgot',
  '/api/admin/login',
  '/api/admin/logout',
  '/api/admin/forgot',
  '/api/admin/reset',
  // BLVBooker staff login (separate auth path; non-staff/non-founder hit here)
  '/admin/booker/login',
  '/api/admin/booker/login',
  '/api/admin/booker/logout',
]);

function isPublicAdminPath(path: string): boolean {
  if (PUBLIC_ADMIN_PATHS.has(path)) return true;
  // Reset pages: /admin/reset/<token>
  if (path.startsWith('/admin/reset/')) return true;
  // Cron endpoints (protected by CRON_SECRET, not session)
  if (path.startsWith('/api/cron/')) return true;
  return false;
}

function isBookerArea(path: string): boolean {
  return path === '/admin/booker' || path.startsWith('/admin/booker/') || path.startsWith('/api/admin/booker/');
}

export const onRequest = defineMiddleware(async ({ url, cookies, redirect, locals }, next) => {
  const path = url.pathname;
  const isAdminArea = path === '/admin' || path.startsWith('/admin/') || path.startsWith('/api/admin/');

  if (!isAdminArea) return next();
  if (isPublicAdminPath(path)) return next();

  // ── BLVBooker branch (RBAC): accept founder admin_users session OR booker_staff session.
  // Founder session → treated as role='owner' with staffId=null.
  if (isBookerArea(path)) {
    const adminSession = readAdminSession(cookies);
    if (adminSession) {
      // Founder = owner
      locals.adminEmail = adminSession.sub;
      (locals as any).bookerActor = {
        role: 'owner',
        staffId: null,
        email: adminSession.sub,
      };
      return next();
    }

    const staffSession = readStaffSession(cookies);
    if (staffSession) {
      (locals as any).bookerActor = {
        role: staffSession.role,
        staffId: staffSession.sub,
        email: staffSession.email,
      };
      locals.adminEmail = staffSession.email;
      return next();
    }

    // No session
    if (path.startsWith('/api/')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return redirect('/admin/booker/login', 302);
  }

  // ── All other admin routes: existing founder-only gate, unchanged.
  const session = readAdminSession(cookies);
  if (!session) {
    // API calls get 401, pages get redirected
    if (path.startsWith('/api/')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return redirect('/admin/login', 302);
  }

  // Pass admin identity to pages
  locals.adminEmail = session.sub;
  return next();
});
