// App-level encryption for secrets kept in the database (client logins vault).
// AES-256-GCM with VAULT_KEY (32 random bytes, base64) — authenticated, so a tampered value fails instead of
// decrypting to garbage. Sealed format: v1.<iv>.<tag>.<ciphertext> (base64 parts).
// The SAME key must be set wherever the shared database is read (local dev + production). Losing it makes every
// sealed value unreadable — it's backed up outside the repo.

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

function vaultKey(): Buffer {
  const raw = (import.meta as any).env?.VAULT_KEY ?? process.env.VAULT_KEY;
  if (!raw) throw new Error('The logins vault isn’t configured on this environment (VAULT_KEY).');
  const key = Buffer.from(String(raw), 'base64');
  if (key.length !== 32) throw new Error('VAULT_KEY must be 32 bytes (base64).');
  return key;
}

export function vaultConfigured(): boolean {
  try { vaultKey(); return true; } catch { return false; }
}

export function seal(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', vaultKey(), iv);
  const data = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return ['v1', iv.toString('base64'), c.getAuthTag().toString('base64'), data.toString('base64')].join('.');
}

export function unseal(sealed: string): string {
  const [v, iv, tag, data] = String(sealed).split('.');
  if (v !== 'v1' || !iv || !tag || data === undefined) throw new Error('Unrecognized sealed value.');
  const d = createDecipheriv('aes-256-gcm', vaultKey(), Buffer.from(iv, 'base64'));
  d.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(data, 'base64')), d.final()]).toString('utf8');
}
