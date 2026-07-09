/**
 * Minimal, dependency-free markdown renderer for JANET's replies.
 * Handles the subset Claude actually emits — **bold**, *italic*, `code`,
 * bullet/numbered lists, paragraphs — as real React nodes (no
 * dangerouslySetInnerHTML, nothing to sanitize). Keeps the command stream
 * from showing literal ** asterisks without pulling a full markdown stack.
 */
import type { ReactNode } from 'react';

/** Inline: `code`, **bold**, *italic* / _italic_. */
function inline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|_[^_]+_)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const tok = m[0];
    const key = `${keyBase}-${i++}`;
    if (tok.startsWith('`')) {
      out.push(
        <code key={key} className="font-mono text-[0.85em] px-1 py-0.5 rounded bg-white/[0.06] text-electric">
          {tok.slice(1, -1)}
        </code>
      );
    } else if (tok.startsWith('**')) {
      out.push(
        <strong key={key} className="font-semibold text-cream">
          {tok.slice(2, -2)}
        </strong>
      );
    } else {
      out.push(
        <em key={key} className="italic">
          {tok.slice(1, -1)}
        </em>
      );
    }
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export default function Markdown({ text }: { text: string }) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const blocks: ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let para: string[] = [];
  let k = 0;

  const flushPara = () => {
    if (para.length) {
      blocks.push(
        <p key={`p-${k++}`} className="whitespace-pre-wrap leading-relaxed">
          {inline(para.join('\n'), `p${k}`)}
        </p>
      );
      para = [];
    }
  };
  const flushList = () => {
    if (list) {
      const L = list;
      const Tag = L.ordered ? 'ol' : 'ul';
      blocks.push(
        <Tag key={`l-${k++}`} className={`${L.ordered ? 'list-decimal' : 'list-disc'} pl-5 space-y-0.5 leading-relaxed`}>
          {L.items.map((it, idx) => (
            <li key={idx}>{inline(it, `li${k}-${idx}`)}</li>
          ))}
        </Tag>
      );
      list = null;
    }
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    const ol = /^\s*\d+\.\s+(.*)$/.exec(line);
    const ul = /^\s*[-*]\s+(.*)$/.exec(line);
    if (ol) {
      flushPara();
      if (!list || !list.ordered) { flushList(); list = { ordered: true, items: [] }; }
      list.items.push(ol[1]);
    } else if (ul) {
      flushPara();
      if (!list || list.ordered) { flushList(); list = { ordered: false, items: [] }; }
      list.items.push(ul[1]);
    } else if (line.trim() === '') {
      flushPara();
      flushList();
    } else {
      flushList();
      para.push(line);
    }
  }
  flushPara();
  flushList();

  return <div className="space-y-2">{blocks}</div>;
}
