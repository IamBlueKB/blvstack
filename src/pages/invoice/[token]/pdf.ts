import type { APIRoute } from 'astro';
import { invoiceIdForToken, assembleInvoiceForDocument } from '../../../lib/janet/clearear/invoicing';
import { renderInvoicePdf } from '../../../lib/janet/clearear/invoice-pdf';

export const prerender = false;

/** GET /invoice/[token]/pdf — the client-facing invoice PDF, reached by its
 *  unguessable token (the token IS the authorization). */
export const GET: APIRoute = async ({ params }) => {
  const id = await invoiceIdForToken(params.token ?? '');
  if (!id) return new Response('Not found', { status: 404 });
  const data = await assembleInvoiceForDocument(id);
  if (!data) return new Response('Not found', { status: 404 });
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
