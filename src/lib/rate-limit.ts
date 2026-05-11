// Simple in-memory rate limiter — Vercel Edge compatible
// For production, swap backing store to Upstash Redis

const store = new Map<string, { count: number; reset: number }>();

interface RateLimitOptions {
  limit: number;
  windowMs: number;
}

export function rateLimit(key: string, options: RateLimitOptions): { allowed: boolean; remaining: number } {
  const now = Date.now();
  const entry = store.get(key);

  if (!entry || entry.reset < now) {
    store.set(key, { count: 1, reset: now + options.windowMs });
    return { allowed: true, remaining: options.limit - 1 };
  }

  if (entry.count >= options.limit) {
    return { allowed: false, remaining: 0 };
  }

  entry.count += 1;
  return { allowed: true, remaining: options.limit - entry.count };
}

// IP extraction helper for Vercel
export function getIP(request: Request): string {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    request.headers.get('x-real-ip') ??
    'unknown'
  );
}
