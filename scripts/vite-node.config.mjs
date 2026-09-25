// vite-node config for server-side scripts (the JANET eval). Exposes, from .env /
// .env.local, the same env prefixes the app reads through import.meta.env.
export default {
  envPrefix: ['PUBLIC_', 'SUPABASE_', 'ANTHROPIC_', 'JANET_', 'RESEND_', 'GOOGLE_', 'PAGESPEED_', 'PSRX_', 'STRIPE_', 'CRON_', 'BREVO_', 'VERCEL_'],
};
