// JANET The Doc (Feature 2) — pure block helpers, safe to import on the CLIENT.
// No supabase / server imports here: docs.ts (server) re-exports these, and the
// DocEditor (browser) imports them directly, so the service-role client never
// reaches the client bundle.

export type DocBlock =
  | { id: string; type: 'heading'; level: 1 | 2 | 3; text: string }
  | { id: string; type: 'text'; text: string }
  | { id: string; type: 'bullet'; text: string }
  | { id: string; type: 'checklist'; text: string; checked: boolean }
  | { id: string; type: 'code'; text: string }
  // Form field (fillable form). JANET writes these in markdown:
  //   ? label            → short text     ?? label           → long text
  //   ?* label | a | b    → single choice  ?+ label | a | b    → multi checkbox
  //   trailing " *" marks a field required.
  | { id: string; type: 'field'; field_type: 'short' | 'long' | 'choice' | 'checkbox'; label: string; options?: string[]; required?: boolean };

/** A doc is a fillable form if it has any field block. */
export function docHasFields(content: DocBlock[]): boolean {
  return (content ?? []).some((b) => b.type === 'field');
}

export type FieldBlock = Extract<DocBlock, { type: 'field' }>;
export function fieldBlocks(content: DocBlock[]): FieldBlock[] {
  return (content ?? []).filter((b): b is FieldBlock => b.type === 'field');
}

// A stored form answer (Phase 5.1). Keyed by BLOCK ID — two fields sharing a label
// no longer collide — and it snapshots the label + type AT SUBMIT TIME, so later
// edits to the doc's labels can never corrupt a client's historical response.
export type FormAnswer = { block_id: string; label: string; field_type: FieldBlock['field_type']; value: string | string[] };

const hasValue = (v: unknown): boolean => (Array.isArray(v) ? v.length > 0 : v != null && String(v).trim() !== '');

/**
 * Build the stored answers from a { blockId: value } submission against the doc's
 * field blocks. Ignores unknown block ids (tamper-safe) and reports required fields
 * left blank — the server-side required validation (5.1).
 */
export function normalizeSubmission(
  content: DocBlock[],
  answersById: Record<string, unknown>
): { answers: FormAnswer[]; missing: string[] } {
  const answers: FormAnswer[] = [];
  const missing: string[] = [];
  for (const f of fieldBlocks(content)) {
    const raw = answersById?.[f.id];
    if (!hasValue(raw)) {
      if (f.required) missing.push(f.label);
      continue;
    }
    answers.push({ block_id: f.id, label: f.label, field_type: f.field_type, value: raw as string | string[] });
  }
  return { answers, missing };
}

/** Render answers for display, handling BOTH the new array shape and the legacy
 *  { label: value } object shape (older responses). */
export function answersForDisplay(answers: unknown): { label: string; value: string }[] {
  const fmt = (v: unknown) => (Array.isArray(v) ? v.join(', ') : String(v ?? ''));
  if (Array.isArray(answers)) {
    return answers.map((a: any) => ({ label: String(a?.label ?? a?.block_id ?? ''), value: fmt(a?.value) }));
  }
  if (answers && typeof answers === 'object') {
    return Object.entries(answers as Record<string, unknown>).map(([k, v]) => ({ label: k, value: fmt(v) }));
  }
  return [];
}

export const DOC_TYPES = ['proposal', 'scope', 'campaign', 'protocol', 'audit', 'brief', 'notes', 'general'] as const;
export type DocType = (typeof DOC_TYPES)[number];

let _uid = 0;
export const blockId = () => `d${Date.now().toString(36)}_${_uid++}`;

export function docToMarkdown(doc: { title: string; content: DocBlock[] }): string {
  const lines: string[] = [`# ${doc.title}`, ''];
  for (const b of doc.content ?? []) {
    switch (b.type) {
      case 'heading':
        lines.push(`${'#'.repeat(b.level + 1)} ${b.text}`, '');
        break;
      case 'bullet':
        lines.push(`- ${b.text}`);
        break;
      case 'checklist':
        lines.push(`- [${b.checked ? 'x' : ' '}] ${b.text}`);
        break;
      case 'code':
        lines.push('```', b.text, '```', '');
        break;
      case 'field': {
        const marker = b.field_type === 'long' ? '??' : b.field_type === 'choice' ? '?*' : b.field_type === 'checkbox' ? '?+' : '?';
        const opts = b.options?.length ? ` | ${b.options.join(' | ')}` : '';
        lines.push(`${marker} ${b.label}${opts}${b.required ? ' *' : ''}`);
        break;
      }
      default:
        lines.push((b as any).text, '');
    }
  }
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

/** Plain text of a doc's body — for search snippets and chat context. */
export function docToText(doc: { content: DocBlock[] }): string {
  return (doc.content ?? []).map((b) => (b.type === 'field' ? b.label : (b as any).text)).filter(Boolean).join('\n');
}

/** Parse markdown into doc blocks — so JANET drafts in markdown (natural) and we
 *  store structured blocks. Inverse of docToMarkdown for the common cases. */
export function markdownToBlocks(md: string): DocBlock[] {
  const out: DocBlock[] = [];
  const lines = (md ?? '').replace(/\r\n/g, '\n').split('\n');
  let inCode = false;
  let codeBuf: string[] = [];
  for (const raw of lines) {
    const line = raw;
    if (line.trim().startsWith('```')) {
      if (inCode) { out.push({ id: blockId(), type: 'code', text: codeBuf.join('\n') }); codeBuf = []; inCode = false; }
      else inCode = true;
      continue;
    }
    if (inCode) { codeBuf.push(line); continue; }
    // Form fields: ? / ?? / ?* / ?+  (see DocBlock 'field' docs above).
    const field = line.match(/^\?([?*+])?\s+(.+)$/);
    if (field) {
      const marker = field[1];
      let rest = field[2].trim();
      const required = /\s\*$/.test(rest);
      if (required) rest = rest.replace(/\s*\*$/, '').trim();
      const field_type = marker === '?' ? 'long' : marker === '*' ? 'choice' : marker === '+' ? 'checkbox' : 'short';
      let label = rest;
      let options: string[] | undefined;
      if (field_type === 'choice' || field_type === 'checkbox') {
        const parts = rest.split('|').map((s) => s.trim()).filter(Boolean);
        label = parts[0] ?? '';
        options = parts.slice(1);
      }
      out.push({ id: blockId(), type: 'field', field_type, label, ...(options && options.length ? { options } : {}), ...(required ? { required: true } : {}) });
      continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      const hashes = heading[1].length;
      const level = (hashes <= 1 ? 1 : Math.min(3, hashes - 1)) as 1 | 2 | 3; // '#'→1, '##'→1, '###'→2, '####'→3
      out.push({ id: blockId(), type: 'heading', level, text: heading[2].trim() });
      continue;
    }
    const check = line.match(/^\s*[-*]\s+\[([ xX])\]\s+(.*)$/);
    if (check) { out.push({ id: blockId(), type: 'checklist', checked: check[1].toLowerCase() === 'x', text: check[2].trim() }); continue; }
    const bullet = line.match(/^\s*[-*]\s+(.*)$/);
    if (bullet) { out.push({ id: blockId(), type: 'bullet', text: bullet[1].trim() }); continue; }
    if (line.trim() === '') { const last = out[out.length - 1]; if (last && last.type === 'text' && last.text !== '') continue; }
    out.push({ id: blockId(), type: 'text', text: line });
  }
  if (inCode && codeBuf.length) out.push({ id: blockId(), type: 'code', text: codeBuf.join('\n') });
  const emptyTextBlock = (b: DocBlock | undefined) => !!b && b.type === 'text' && !b.text.trim();
  while (out.length && emptyTextBlock(out[0])) out.shift();
  while (out.length && emptyTextBlock(out[out.length - 1])) out.pop();
  return out.length ? out : [{ id: blockId(), type: 'text', text: '' }];
}
