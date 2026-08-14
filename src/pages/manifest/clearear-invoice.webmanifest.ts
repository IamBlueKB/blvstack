import type { APIRoute } from 'astro';

// Per-business web app manifest for the "New invoice" home-screen launcher. Installing
// from /admin/clearear/invoices/new?business=X gives a standalone icon that opens
// straight to the create-invoice page for that business.
export const prerender = false;

export const GET: APIRoute = ({ url }) => {
  const isBlv = url.searchParams.get('business') === 'blvstack';
  const business = isBlv ? 'blvstack' : 'clearear';
  const manifest = {
    name: isBlv ? 'New BLVSTACK Invoice' : 'New Clear Ear Invoice',
    short_name: isBlv ? 'BLV Invoice' : 'CE Invoice',
    description: 'Create an invoice, then copy the pay link to send.',
    start_url: `/admin/clearear/invoices/new?business=${business}`,
    scope: '/admin/clearear/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#0A1628',
    theme_color: '#0A1628',
    icons: isBlv
      ? [
          { src: '/blvstack-appicon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/blvstack-appicon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
        ]
      : [
          { src: '/clearear-appicon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/clearear-appicon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
        ],
  };
  return new Response(JSON.stringify(manifest), {
    headers: { 'Content-Type': 'application/manifest+json; charset=utf-8', 'Cache-Control': 'public, max-age=3600' },
  });
};
