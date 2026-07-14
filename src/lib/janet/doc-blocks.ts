// JANET The Doc (Feature 2) — pure block helpers, safe to import on the CLIENT.
// No supabase / server imports here: docs.ts (server) re-exports these, and the
// DocEditor (browser) imports them directly, so the service-role client never
// reaches the client bundle.

export type DocBlock =
  | { id: string; type: 'heading'; level: 1 | 2 | 3; text: string }
  | { id: string; type: 'text'; text: string }
  | { id: string; type: 'bullet'; text: string }
  | { id: string; type: 'checklist'; text: string; checked: boolean }
  | { id: string; type: 'code'; text: string };

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
      default:
        lines.push(b.text, '');
    }
  }
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

/** Plain text of a doc's body — for search snippets and chat context. */
export function docToText(doc: { content: DocBlock[] }): string {
  return (doc.content ?? []).map((b) => b.text).filter(Boolean).join('\n');
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
    if (line.trim() === '') { if (out.length && out[out.length - 1].type === 'text' && out[out.length - 1].text !== '') continue; }
    out.push({ id: blockId(), type: 'text', text: line });
  }
  if (inCode && codeBuf.length) out.push({ id: blockId(), type: 'code', text: codeBuf.join('\n') });
  while (out.length && out[0].type === 'text' && !out[0].text.trim()) out.shift();
  while (out.length && out[out.length - 1].type === 'text' && !out[out.length - 1].text.trim()) out.pop();
  return out.length ? out : [{ id: blockId(), type: 'text', text: '' }];
}
