/// <reference types="astro/client" />

declare namespace App {
  interface Locals {
    adminEmail?: string;
  }
}

interface ImportMetaEnv {
  readonly PUBLIC_SUPABASE_URL: string;
  readonly PUBLIC_SUPABASE_ANON_KEY: string;
  readonly SUPABASE_SERVICE_ROLE_KEY: string;
  readonly RESEND_API_KEY: string;
  readonly ANTHROPIC_API_KEY: string;
  readonly PUBLIC_PLAUSIBLE_DOMAIN: string;
  readonly TURNSTILE_SECRET_KEY: string;
  readonly PUBLIC_TURNSTILE_SITE_KEY: string;
  readonly FOUNDER_EMAIL: string;
  readonly ADMIN_EMAIL: string;
  readonly ADMIN_PASSWORD: string;
  readonly ADMIN_SESSION_SECRET: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
