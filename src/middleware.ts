import { defineMiddleware } from 'astro:middleware';
import { readAdminSession } from './lib/admin-session';

// Gate every /admin/* page on a valid session cookie.
// /admin/login + /api/admin/login are open. Everything else redirects.

const PUBLIC_ADMIN_PATHS = new Set<string>([
  '/admin/login',
  '/admin/forgot',
  '/api/admin/login',
  '/api/admin/logout',
  '/api/admin/forgot',
  '/api/admin/reset',
]);

function isPublicAdminPath(path: string): boolean {
  if (PUBLIC_ADMIN_PATHS.has(path)) return true;
  // Reset pages: /admin/reset/<token>
  if (path.startsWith('/admin/reset/')) return true;
  return false;
}

export const onRequest = defineMiddleware(async ({ url, cookies, redirect, locals }, next) => {
  const path = url.pathname;
  const isAdminArea = path === '/admin' || path.startsWith('/admin/') || path.startsWith('/api/admin/');

  if (!isAdminArea) return next();
  if (isPublicAdminPath(path)) return next();

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
