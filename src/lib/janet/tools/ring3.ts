// JANET v1 — Ring 3 tools (spec §6): external / irreversible. NEVER executed
// without explicit Blue approval. The registry refuses a Ring 3 call that
// doesn't carry approvedByUser; the brain turns a Ring 3 tool call into a plan
// card, and only /api/janet/approve runs the handler (with approvedByUser=true)
// after Blue clicks Approve.
//
// v1 keeps Ring 3 minimal — just send_email over the existing Resend infra.

import { resend, FOUNDER_EMAIL } from '../../resend';
import { supabaseAdmin } from '../../supabase';
import type { JanetTool } from '../types';

function reqString(input: unknown, key: string): string {
  const v = (input as any)?.[key];
  if (typeof v !== 'string' || !v.trim()) throw new Error(`Missing required input: ${key}`);
  return v;
}

/** JANET sends as Blue over the verified BLVSTACK domain. */
const SEND_FROM = `Blue <${FOUNDER_EMAIL}>`;

export const ring3Tools: JanetTool[] = [
  {
    name: 'send_email',
    description:
      'Send a real email to a real person over BLVSTACK email. This LEAVES the building — it always requires Blue to approve the drafted email first. Provide the full drafted content; Blue reviews and approves before it sends.',
    ring: 3,
    input_schema: {
      type: 'object',
      properties: {
        to: { type: 'string', description: 'Recipient email address' },
        subject: { type: 'string' },
        body: { type: 'string', description: 'Plain-text email body, signed as Blue' },
        deal_id: { type: 'string', description: 'Optional deal to associate' },
      },
      required: ['to', 'subject', 'body'],
    },
    handler: async (input) => {
      const to = reqString(input, 'to');
      const subject = reqString(input, 'subject');
      const body = reqString(input, 'body');

      const { data, error } = await resend.emails.send({
        from: SEND_FROM,
        to,
        subject,
        replyTo: FOUNDER_EMAIL,
        text: body,
      });
      if (error) throw new Error(typeof error === 'string' ? error : (error as any).message ?? 'send failed');

      // Best-effort: note the send on the deal.
      const dealId = (input as any)?.deal_id;
      if (typeof dealId === 'string' && dealId) {
        await supabaseAdmin
          .from('janet_deals')
          .update({ updated_at: new Date().toISOString() })
          .eq('id', dealId);
      }

      return { sent: true, id: data?.id ?? null, to, subject };
    },
  },
];
