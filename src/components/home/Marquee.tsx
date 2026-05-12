import { useRef, useEffect } from 'react';

const ITEMS = [
  'AI Agents',
  'Automation Systems',
  'Custom Integrations',
  'Lead Pipelines',
  'AI-Native Websites',
  'Voice Agents',
  'Workflow Automation',
];

// Three-tone hierarchy that cycles across items
const TONES = ['cream', 'slate', 'electric'] as const;
const TONE_CLASS: Record<typeof TONES[number], string> = {
  cream: 'text-cream/85',
  slate: 'text-slate',
  electric: 'text-electric',
};
const DOT_CLASS: Record<typeof TONES[number], string> = {
  cream: 'bg-cream/70',
  slate: 'bg-slate',
  electric: 'bg-electric',
};

function Track({
  items,
  speed,
  direction,
  size,
}: {
  items: string[];
  speed: number;             // px/sec
  direction: 1 | -1;         // 1 = left, -1 = right
  size: 'lg' | 'sm';
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const posRef = useRef(0);
  const rafRef = useRef<number>(0);
  const pausedRef = useRef(false);
  const lastTime = useRef(performance.now());

  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;

    // Initialize starting position for right-scrolling rows
    // so they don't briefly show an empty gap
    const half = el.scrollWidth / 2;
    if (direction === -1) posRef.current = -half;

    const tick = (now: number) => {
      const dt = (now - lastTime.current) / 1000;
      lastTime.current = now;
      if (!pausedRef.current && el) {
        posRef.current -= direction * speed * dt;
        if (direction === 1 && Math.abs(posRef.current) >= half) posRef.current = 0;
        if (direction === -1 && posRef.current >= 0) posRef.current = -half;
        el.style.transform = `translate3d(${posRef.current}px, 0, 0)`;
      }
      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [direction, speed]);

  const doubled = [...items, ...items];
  const fontSize = size === 'lg' ? 'text-2xl md:text-3xl' : 'text-xs';
  const fontWeight = size === 'lg' ? 'font-bold' : 'font-medium';
  const padX = size === 'lg' ? 'px-6 md:px-8' : 'px-5';

  return (
    <div
      className="flex will-change-transform"
      ref={trackRef}
      onMouseEnter={() => { pausedRef.current = true; }}
      onMouseLeave={() => { pausedRef.current = false; }}
    >
      {doubled.map((item, i) => {
        const tone = TONES[i % TONES.length];
        const dotPulseDelay = `${(i % 5) * 0.2}s`;
        return (
          <div key={i} className="flex items-center whitespace-nowrap shrink-0">
            {/* Pulse dot */}
            <span className={`relative flex w-1.5 h-1.5 ${size === 'lg' ? 'mr-4' : 'mr-3'}`}>
              <span
                className={`absolute inset-0 rounded-full ${DOT_CLASS[tone]} animate-ping opacity-60`}
                style={{ animationDelay: dotPulseDelay }}
              />
              <span className={`relative w-1.5 h-1.5 rounded-full ${DOT_CLASS[tone]}`} />
            </span>
            {/* Word */}
            <span
              className={`${fontWeight} ${TONE_CLASS[tone]} ${padX} ${
                size === 'lg' ? 'tracking-tight' : 'font-mono tracking-widest uppercase'
              } ${fontSize}`}
            >
              {item}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export default function Marquee() {
  return (
    <section className="relative border-t border-b border-white/5 overflow-hidden bg-navy py-8 md:py-10">
      {/* Edge fades */}
      <div
        className="pointer-events-none absolute left-0 top-0 h-full w-24 md:w-40 z-10"
        style={{ background: 'linear-gradient(to right, #0A1628, transparent)' }}
      />
      <div
        className="pointer-events-none absolute right-0 top-0 h-full w-24 md:w-40 z-10"
        style={{ background: 'linear-gradient(to left, #0A1628, transparent)' }}
      />

      <Track items={ITEMS} speed={55} direction={1} size="lg" />
    </section>
  );
}
