/**
 * AI reply composer for inbound contact_messages.
 * Drafts a warm + professional reply to a visitor's message.
 */

import { anthropic, MODEL } from './anthropic';

const REPLY_SYSTEM = `You are writing a personal email reply on behalf of the BLVSTACK founder to a visitor who submitted the contact form.

BLVSTACK is an AI systems studio that builds custom AI agents, automation systems, and internal tools for businesses.

Voice: warm, professional, conversational. Founder-to-founder energy — not corporate, not chatbot. Reference what they actually said.

Rules:
- Address them by first name.
- Acknowledge what they wrote specifically (don't paraphrase generically).
- If they asked a question: answer it directly when possible, or say a 15-minute call is the fastest way to dig in.
- If they want to work with BLVSTACK: invite them to a discovery call, point them to /start, or offer a few times.
- If it's clearly spam, low-effort, or off-topic: politely decline in one or two sentences.
- Sign-off: "— Blue" (no titles, no company line). No email signature block.
- No fluff openers like "Thanks for reaching out!" or "I appreciate your message." Get to the point on line 1.
- 3-6 short paragraphs max.

Output ONLY valid JSON. No preamble, no markdown fences. Schema:
{
  "subject": "string (concise, references their topic; if their original had no subject context, use 'Re: your note to BLVSTACK')",
  "body": "string (plain-text email body; use \\n for line breaks)"
}`;

export async function composeReply(opts: {
  name: string;
  email: string;
  message: string;
}): Promise<{ subject: string; body: string }> {
  const userPrompt = `Visitor: ${opts.name} (${opts.email})

Their message:
"""
${opts.message}
"""

Write the reply.`;

  const resp = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 1024,
    system: REPLY_SYSTEM,
    messages: [{ role: 'user', content: userPrompt }],
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

  const parsed = JSON.parse(cleaned);
  return {
    subject: String(parsed.subject ?? 'Re: your note to BLVSTACK'),
    body: String(parsed.body ?? ''),
  };
}
