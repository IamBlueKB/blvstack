import Stripe from 'stripe';

let _s: Stripe | null = null;
export function stripe(): Stripe {
  if (_s) return _s;
  const key = (import.meta as any).env?.STRIPE_SECRET_KEY;
  if (!key) throw new Error('STRIPE_SECRET_KEY is not configured on this environment.');
  _s = new Stripe(key, { apiVersion: '2024-12-18.acacia' as any });
  return _s;
}

export function stripeConfigured(): boolean {
  return !!(import.meta as any).env?.STRIPE_SECRET_KEY;
}
