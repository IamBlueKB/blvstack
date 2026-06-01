/**
 * Normalizer — takes a raw scraped gig record, runs it through Claude
 * to produce a clean structured representation + filter out non-gigs.
 *
 * Sets is_real_gig to filter spam/non-gigs at the DB level.
 */

import { anthropic, MODEL } from '../anthropic';
import type { GigNormalized } from './types';

const NORMALIZER_SYSTEM = `You normalize raw gig postings for BLVBooker. You will be given a single posting and must return a structured JSON record.

Output ONLY valid JSON. No preamble, no markdown fences. Schema:
{
  "title": "string (concise, ≤80 chars)",
  "vertical": "dj|rapper|singer|band|musician|poet|visual_artist|any",
  "city": "string|null",
  "region": "string|null (2-letter state if US)",
  "gig_date": "YYYY-MM-DD|null",
  "pay_amount": "integer|null (whole dollars; convert ranges to midpoint)",
  "pay_text": "string|null (original pay phrasing)",
  "requirements": "string|null (short summary, ≤200 chars)",
  "contact_email": "string|null",
  "contact_method": "string|null",
  "is_real_gig": true | false,
  "confidence": 0.0-1.0
}

Rules for is_real_gig:
- TRUE if: real "performer wanted" posting; legitimate event needing a performer; open mic / call for submissions; venue booking inquiry form
- FALSE if: spam, scam ("send money to apply"), DJ/performer offering services (wrong direction), gear-for-sale, MLM, vague/unactionable
- If confidence < 0.5, set is_real_gig: false

Return null for any field you can't determine. Never fabricate.`;

export async function normalizeGig(rawText: string, hints?: {
  source_url?: string | null;
  contact_email?: string | null;
  venue_name?: string | null;
}): Promise<GigNormalized> {
  const hintBlock = hints
    ? `\n\nKnown values (use if accurate, otherwise re-extract):\n${JSON.stringify(hints, null, 2)}\n`
    : '';

  const resp = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 1024,
    system: NORMALIZER_SYSTEM,
    messages: [
      {
        role: 'user',
        content: `Posting to normalize:${hintBlock}\n\nRaw text:\n${rawText.slice(0, 6000)}`,
      },
    ],
  });

  const text = resp.content
    .filter((b: any) => b.type === 'text')
    .map((b: any) => b.text)
    .join('')
    .trim();

  const cleaned = text
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/, '')
    .replace(/\s*```\s*$/, '');

  try {
    return JSON.parse(cleaned);
  } catch (err: any) {
    console.error(`[booker-normalizer] error: parse failed — ${text.slice(0, 200)}`);
    return { is_real_gig: false, confidence: 0 };
  }
}
