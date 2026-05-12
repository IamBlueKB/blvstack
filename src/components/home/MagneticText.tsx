import { useRef } from 'react';

export default function MagneticText({ text, className }: { text: string; className?: string }) {
  const wrapRef = useRef<HTMLSpanElement>(null);
  const charRefs = useRef<(HTMLSpanElement | null)[]>([]);

  const handleMove = (e: React.MouseEvent) => {
    charRefs.current.forEach((s) => {
      if (!s) return;
      const r = s.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const dx = e.clientX - cx;
      const dy = e.clientY - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const radius = 120;
      if (dist < radius) {
        const force = (1 - dist / radius) * 12;
        const x = (dx / dist) * force;
        const y = (dy / dist) * force;
        s.style.transform = `translate(${x.toFixed(2)}px, ${y.toFixed(2)}px)`;
      } else {
        s.style.transform = '';
      }
    });
  };

  const handleLeave = () => {
    charRefs.current.forEach((s) => {
      if (s) s.style.transform = '';
    });
  };

  const words = text.split(' ');
  let counter = 0;

  return (
    <span
      ref={wrapRef}
      onMouseMove={handleMove}
      onMouseLeave={handleLeave}
      className={className}
    >
      {words.map((word, wi) => {
        const wordSpan = (
          <span key={'w' + wi} style={{ display: 'inline-block', whiteSpace: 'nowrap' }}>
            {word.split('').map((c) => {
              const i = counter++;
              return (
                <span
                  key={i}
                  ref={(el) => { charRefs.current[i] = el; }}
                  className="inline-block"
                  style={{ transition: 'transform 0.4s cubic-bezier(0.16, 1, 0.3, 1)' }}
                >
                  {c}
                </span>
              );
            })}
          </span>
        );
        if (wi < words.length - 1) {
          return [wordSpan, <span key={'s' + wi}> </span>];
        }
        return wordSpan;
      })}
    </span>
  );
}
