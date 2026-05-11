import { Resend } from 'resend';

export const resend = new Resend(import.meta.env.RESEND_API_KEY);

export const FOUNDER_EMAIL = import.meta.env.FOUNDER_EMAIL ?? 'hello@blvstack.com';
export const FROM_EMAIL = 'BLVSTACK <noreply@blvstack.com>';
