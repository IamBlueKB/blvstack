import type { APIRoute } from 'astro';
import { assembleInvoiceForDocument } from '../../../../../../lib/janet/clearear/invoicing';
import { renderInvoicePdf } from '../../../../../../lib/janet/clearear/invoice-pdf';

export const prerender = false;

/** GET /api/admin/clearear/invoices/[id]/pdf — download the branded invoice PDF.
 *  Founder-gated. */
export const GET: APIRoute = async ({ params, locals }) => {
  if (!locals.adminEmail) return new Response('Unauthorized', { status: 401 });
  const data = await assembleInvoiceForDocument(params.id!);
  if (!data) return new Response('Invoice not found', { status: 404 });
  const pdf = await renderInvoicePdf(data as any);
  return new Response(new Uint8Array(pdf), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${(data.invoice as any).invoice_number}.pdf"`,
      'Cache-Control': 'no-store',
    },
  });
};
