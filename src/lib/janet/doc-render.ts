// Shared proposal/doc rendering — used by BOTH the live published page ([slug].astro)
// and the admin preview (admin/docs/[id]/preview.astro), so a preview shows exactly
// what will publish. Blocks → safe HTML sections; markdown promoted from a small
// closed set of markers (escape FIRST, then promote), links restricted to safe schemes.

import type { DocBlock } from './doc-blocks';

export const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export const inline = (s: string) =>
  esc(s)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+|\/[^)\s]*|mailto:[^)\s]+)\)/g, '<a href="$2" rel="noopener">$1</a>');

export const isRule = (s: string) => /^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(s);
export const sectionId = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'section';

export type Section = { id: string; label: string; html: string };

/** Group blocks into sections by level-1 headings; consecutive bullets collapse into
 *  lists. Field blocks render as form inputs (keyed by BLOCK ID). */
export function buildSections(blocks: DocBlock[]): Section[] {
  const sections: Section[] = [];
  let cur: Section = { id: 'intro', label: 'intro', html: '' };
  let listOpen: 'ul' | null = null;
  const closeList = () => { if (listOpen) { cur.html += '</ul>'; listOpen = null; } };
  const push = () => { closeList(); if (cur.html.trim()) sections.push(cur); };
  for (const b of blocks ?? []) {
    if (b.type === 'heading' && b.level === 1) {
      push();
      cur = { id: sectionId(b.text), label: b.text || 'section', html: `<h2>${inline(b.text)}</h2>` };
      continue;
    }
    if (b.type === 'heading') { closeList(); cur.html += `<h${b.level + 1}>${inline(b.text)}</h${b.level + 1}>`; continue; }
    if (b.type === 'bullet') { if (!listOpen) { cur.html += '<ul>'; listOpen = 'ul'; } cur.html += `<li>${inline(b.text)}</li>`; continue; }
    closeList();
    if (b.type === 'checklist') { cur.html += `<p class="chk">${b.checked ? '✓' : '○'} ${inline(b.text)}</p>`; continue; }
    if (b.type === 'code') { cur.html += `<pre>${esc(b.text)}</pre>`; continue; }
    if (b.type === 'field') {
      const nm = esc(b.label);
      const bid = esc(b.id);
      const disp = inline(b.label);
      const req = b.required ? ' required' : '';
      const mark = b.required ? ' <span class="req">*</span>' : '';
      if (b.field_type === 'long') cur.html += `<label class="fld"><span>${disp}${mark}</span><textarea rows="3" data-field data-block-id="${bid}" data-label="${nm}"${req}></textarea></label>`;
      else if (b.field_type === 'short') cur.html += `<label class="fld"><span>${disp}${mark}</span><input type="text" data-field data-block-id="${bid}" data-label="${nm}"${req}></label>`;
      else {
        const type = b.field_type === 'choice' ? 'radio' : 'checkbox';
        const opts = (b.options ?? []).map((o) => `<label class="opt"><input type="${type}" name="f_${bid}" value="${esc(o)}" data-field data-block-id="${bid}" data-label="${nm}"> <span>${esc(o)}</span></label>`).join('');
        cur.html += `<fieldset class="fld"><legend>${disp}${mark}</legend>${opts}</fieldset>`;
      }
      continue;
    }
    if (!b.text.trim()) continue;
    if (isRule(b.text)) { cur.html += '<hr class="rule">'; continue; }
    if (/^—\s*from JANET/i.test(b.text)) { cur.html += `<p class="attr">${inline(b.text)}</p>`; continue; }
    cur.html += `<p>${inline(b.text)}</p>`;
  }
  push();
  return sections;
}
