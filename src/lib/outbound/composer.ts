/**
 * Composer agent — writes personalized cold outreach emails
 * based on prospect research.
 *
 * Niche-aware: when prospect.niche resolves to a LIVE niche, the composer
 * uses that niche's offer + voice + banned phrases + required elements.
 * When niche is NULL or status='scaffold', falls back to the generic prompt.
 *
 * Follow-ups remain generic (out of scope per SUNRESPONSE_NICHE_SPEC §2).
 */

import { anthropic, MODEL } from '../anthropic';
import { getNiche, type NicheConfig } from '../niches';

const COMPOSER_SYSTEM = `You are writing a cold outreach email from Blue, the founder of BLVSTACK, an AI systems studio.

This is a first-touch cold email to someone who has NOT contacted BLVSTACK. The email must feel like a real person wrote it in Gmail — not a marketing email, not a template.

Rules:
- 60-100 words. Shorter is better. Every sentence must earn its place.
- Plain text only. No HTML, no formatting, no bold, no bullet points.
- Reference ONE specific thing from their business that shows you did your homework.
- Propose ONE clear next step (usually a 15-minute call).
- No compliments ("Love what you're doing"). No fake urgency. No "I noticed that...".
- Open with something direct. Not "Hi [Name], I'm Blue from BLVSTACK."
- Sign as "Blue"
- No emojis. No exclamation marks.
- Write like a founder texting another founder, not a salesperson.

Output TWO things separated by "---":
1. Subject line (under 50 chars, lowercase, no clickbait)
2. Email body

Example output format:
quick question about [specific thing]
---
[email body here]

Blue`;

const FOLLOWUP_SYSTEM = `You are writing a follow-up email from Blue, the founder of BLVSTACK, an AI systems studio.

This is a follow-up to a cold email that got no reply. Keep it even shorter than the original.

Rules:
- 30-60 words max.
- Do NOT repeat the original pitch. Add one new angle or observation.
- Plain text only. No HTML.
- Casual, not pushy. "Bumping this" is banned.
- If this is follow-up 2 or 3, be even more concise. Last follow-up should be a soft close ("No worries if the timing is off").
- Sign as "Blue"
- No emojis. No exclamation marks.

Output ONLY the email body. No subject line (follow-ups stay in the same thread).`;

export interface ComposeResult {
  subject: string;
  body: string;
}

/**
 * Build the system prompt for a niche-specific composer pass.
 * Only called when the prospect resolves to a LIVE niche.
 * Returns a self-contained prompt with offer, voice, format, required
 * elements, and banned phrases — using the same `subject\n---\nbody`
 * output contract as the generic composer so the parser stays unified.
 */
function buildNicheSystemPrompt(niche: NicheConfig): string {
  const { offer, composer } = niche;
  return `You are writing a cold outreach email from Blue, founder of BLVSTACK, to the owner or head of sales at a ${niche.label} business.

THE OFFER YOU ARE SELLING — ${offer.name}
${offer.oneLiner}

Problem framing (use this math and logic, but in your own words — do NOT quote verbatim):
${offer.problemFraming}

Pricing:
- Build: $${offer.buildPrice.toLocaleString()} — ${offer.buildTimeline}
- Monthly: $${offer.monthlyPrice.toLocaleString()}
- Pilot terms: ${offer.pilotTerms}

Key differentiators you can pull from (pick 1–2 max, do not list all):
${offer.keyDifferentiators.map((d) => `- ${d}`).join('\n')}

VOICE & FORMAT
${composer.voiceNotes}

Subject line: ${composer.subjectLineStyle}
Body length: ${composer.bodyWordCount[0]}–${composer.bodyWordCount[1]} words

REQUIRED ELEMENTS (every email must include all of these):
${composer.requiredElements.map((r) => `- ${r}`).join('\n')}

BANNED PHRASES (never use any of these, even paraphrased):
${composer.bannedPhrases.map((b) => `"${b}"`).join(', ')}

OUTPUT FORMAT — exactly:
[subject line]
---
[email body]

Sign the body on its own final line: "— Blue"`;
}

export async function composeInitialEmail(
  prospect: {
    contact_name: string | null;
    company_name: string | null;
    company_url: string | null;
    pain_points: string | null;
    ai_research: any;
    niche?: string | null;
  }
): Promise<ComposeResult> {
  const research = prospect.ai_research ?? {};
  const firstName = prospect.contact_name?.split(' ')[0] ?? null;

  // Route system prompt: live niche → niche-specific; null or scaffold → generic.
  const niche = getNiche(prospect.niche);
  const systemPrompt =
    niche && niche.status === 'live'
      ? buildNicheSystemPrompt(niche)
      : COMPOSER_SYSTEM;

  const userPrompt = `Prospect details:
Name: ${prospect.contact_name ?? 'unknown'}${firstName ? ` (use: ${firstName})` : ''}
Company: ${prospect.company_name ?? 'unknown'}
Website: ${prospect.company_url ?? 'unknown'}

Research summary:
${research.company_summary ?? 'No summary available'}

Pain points identified:
${research.pain_points?.map((p: any) => `- ${p.problem} → ${p.blvstack_solution} (${p.tier})`).join('\n') ?? prospect.pain_points ?? 'None identified'}

Best outreach angle:
${research.outreach_angle ?? 'No specific angle identified'}

Write the cold email.`;

  const resp = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 600,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
  });

  const text = resp.content
    .filter((b: any) => b.type === 'text')
    .map((b: any) => b.text)
    .join('')
    .trim();

  const parts = text.split(/\n---\n/);
  if (parts.length >= 2) {
    return {
      subject: parts[0].trim(),
      body: parts.slice(1).join('\n---\n').trim(),
    };
  }

  // Fallback: treat first line as subject
  const lines = text.split('\n');
  return {
    subject: lines[0].trim(),
    body: lines.slice(1).join('\n').trim(),
  };
}

export async function composeFollowUp(
  prospect: {
    contact_name: string | null;
    company_name: string | null;
    pain_points: string | null;
    ai_research: any;
  },
  previousEmails: string[],
  followUpNumber: number
): Promise<string> {
  const firstName = prospect.contact_name?.split(' ')[0] ?? null;
  const research = prospect.ai_research ?? {};

  const userPrompt = `This is follow-up #${followUpNumber} (of 3 max).

Prospect: ${prospect.contact_name ?? 'unknown'}${firstName ? ` (use: ${firstName})` : ''} at ${prospect.company_name ?? 'unknown'}

Previous emails sent:
${previousEmails.map((e, i) => `--- Email ${i + 1} ---\n${e}`).join('\n\n')}

Company context:
${research.company_summary ?? 'No summary'}
${research.outreach_angle ?? ''}

Write the follow-up.`;

  const resp = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 300,
    system: FOLLOWUP_SYSTEM,
    messages: [{ role: 'user', content: userPrompt }],
  });

  return resp.content
    .filter((b: any) => b.type === 'text')
    .map((b: any) => b.text)
    .join('')
    .trim();
}
