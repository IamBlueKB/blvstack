// Cloudflare Turnstile — server-side token check, shared by the public forms.

export async function verifyTurnstile(secret: string, token: unknown, ip: string): Promise<boolean> {
  if (!token || typeof token !== 'string') return false;
  try {
    const form = new URLSearchParams({ secret, response: token, remoteip: ip });
    const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: form });
    const j = await r.json();
    return j.success === true;
  } catch {
    return false;
  }
}
