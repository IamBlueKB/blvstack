import type { APIRoute } from 'astro';
import { Document, Packer, Paragraph, TextRun, HeadingLevel } from 'docx';
import { getDoc, docToMarkdown, type DocBlock } from '../../../../../lib/janet/docs';
import { renderDocPdf } from '../../../../../lib/janet/doc-pdf';
import { supabaseAdmin } from '../../../../../lib/supabase';

export const prerender = false;

/**
 * GET /api/janet/docs/[id]/export?format=md|docx|pdf
 *   md   → clean markdown download
 *   docx → a real .docx built with the docx package
 *   pdf  → a print-styled page that opens the browser's Save-as-PDF
 * Auth: founder blvstack_admin session (middleware).
 */
export const GET: APIRoute = async ({ locals, params, url }) => {
  if (!locals.adminEmail) return new Response('Unauthorized', { status: 401 });
  const doc = await getDoc(params.id!);
  if (!doc) return new Response('Not found', { status: 404 });
  const format = url.searchParams.get('format') ?? 'md';
  const safeName = (doc.title || 'doc').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'doc';

  if (format === 'md') {
    return new Response(docToMarkdown(doc), {
      headers: { 'Content-Type': 'text/markdown; charset=utf-8', 'Content-Disposition': `attachment; filename="${safeName}.md"` },
    });
  }

  if (format === 'docx') {
    const children: Paragraph[] = [new Paragraph({ text: doc.title, heading: HeadingLevel.TITLE })];
    for (const b of doc.content as DocBlock[]) {
      children.push(blockToParagraph(b));
    }
    const document = new Document({ sections: [{ children }] });
    const buffer = await Packer.toBuffer(document);
    return new Response(new Uint8Array(buffer), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'Content-Disposition': `attachment; filename="${safeName}.docx"`,
      },
    });
  }

  if (format === 'pdf') {
    // A real, designed PDF (pdfkit) — on-brand, forwardable, filable.
    let clientName: string | null = null;
    if (doc.client_id) {
      const { data } = await supabaseAdmin.from('janet_clients').select('name').eq('id', doc.client_id).maybeSingle();
      clientName = data?.name ?? null;
    }
    const buffer = await renderDocPdf({ title: doc.title, content: doc.content, client_name: clientName, doc_type: doc.doc_type });
    return new Response(new Uint8Array(buffer), {
      headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${safeName}.pdf"` },
    });
  }

  return new Response('Unknown format', { status: 400 });
};

function blockToParagraph(b: DocBlock): Paragraph {
  switch (b.type) {
    case 'heading':
      return new Paragraph({ text: b.text, heading: b.level === 1 ? HeadingLevel.HEADING_1 : b.level === 2 ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_3 });
    case 'bullet':
      return new Paragraph({ text: b.text, bullet: { level: 0 } });
    case 'checklist':
      return new Paragraph({ children: [new TextRun(`${b.checked ? '☑' : '☐'} ${b.text}`)] });
    case 'code':
      return new Paragraph({ children: [new TextRun({ text: b.text, font: 'Consolas' })] });
    default:
      return new Paragraph({ children: [new TextRun(b.text)] });
  }
}

