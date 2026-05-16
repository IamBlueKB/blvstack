import { useEffect, useRef, useState } from 'react';
import Brand from '../Brand';

// ---------- Magnetic title — characters attract toward cursor ----------
function MagneticText({ text, className }: { text: string; className?: string }) {
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

  return (
    <span
      ref={wrapRef}
      onMouseMove={handleMove}
      onMouseLeave={handleLeave}
      className={className}
    >
      {(() => {
        const words = text.split(' ');
        let counter = 0;
        const out = [];
        words.forEach((word, wi) => {
          out.push(
            <span key={'w'+wi} style={{ display: 'inline-block', whiteSpace: 'nowrap' }}>
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
            out.push(<span key={'s'+wi}>{' '}</span>);
          }
        });
        return out;
      })()}
    </span>
  );
}

// ---------- Sim 01 — AgentSim: streaming chat dialogue ----------
const CHAT_SCRIPT = [
  { role: 'user',  text: 'Need a quote for 50 units to Austin' },
  { role: 'agent', text: 'Pulling pricing now — one sec.' },
  { role: 'user',  text: 'And lead time?' },
  { role: 'agent', text: 'Lead time on 50 is 4 business days. Sending the quote to your email now.' },
];

function AgentSim({ active }: { active: boolean }) {
  const [step, setStep] = useState(0);
  const [streamed, setStreamed] = useState(0);
  const stepRef = useRef(0);
  const streamedRef = useRef(0);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    let paused = false;
    let pauseTimer: number | null = null;

    const tick = () => {
      if (cancelled || paused) return;
      const current = CHAT_SCRIPT[stepRef.current % CHAT_SCRIPT.length];
      if (streamedRef.current < current.text.length) {
        streamedRef.current = Math.min(streamedRef.current + 2, current.text.length);
        setStreamed(streamedRef.current);
      } else {
        // Schedule next message advance exactly once
        paused = true;
        pauseTimer = window.setTimeout(() => {
          stepRef.current = (stepRef.current + 1) % CHAT_SCRIPT.length;
          streamedRef.current = 0;
          setStep(stepRef.current);
          setStreamed(0);
          paused = false;
          pauseTimer = null;
        }, 1100);
      }
    };

    const intervalId = window.setInterval(tick, 32);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      if (pauseTimer) window.clearTimeout(pauseTimer);
    };
  }, [active]);

  const visible = CHAT_SCRIPT.slice(0, (step % CHAT_SCRIPT.length) + 1);
  const showCursor = streamed < (CHAT_SCRIPT[step % CHAT_SCRIPT.length]?.text.length ?? 0);

  return (
    <div className="flex flex-col h-full font-mono">
      {/* Header bar */}
      <div className="flex items-center justify-between pb-2 mb-2 border-b border-white/5">
        <div className="flex items-center gap-2">
          <span className="relative flex w-1.5 h-1.5">
            <span className="absolute inset-0 rounded-full bg-electric animate-ping opacity-75" />
            <span className="relative w-1.5 h-1.5 rounded-full bg-electric" />
          </span>
          <span className="text-[9px] tracking-widest uppercase text-cream/70">
            Agent · Live
          </span>
        </div>
        <span className="text-[9px] tracking-widest uppercase text-slate/70">
          session.001
        </span>
      </div>

      {/* Messages anchored to bottom */}
      <div className="flex-1 flex flex-col justify-end gap-1.5 overflow-hidden text-[10px]">
        {visible.map((m, i) => {
          const isLast = i === visible.length - 1;
          const text = isLast ? m.text.slice(0, streamed) : m.text;
          return (
            <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div
                className={`max-w-[88%] px-2 py-1 leading-snug ${
                  m.role === 'user'
                    ? 'bg-electric/10 border border-electric/30 text-cream/90'
                    : 'bg-white/[0.03] border border-white/10 text-cream/80'
                }`}
              >
                {text}
                {isLast && m.role === 'agent' && streamed < m.text.length && (
                  <span className="inline-block w-1 h-2.5 bg-electric ml-0.5 align-middle animate-pulse" />
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Status footer — composing indicator */}
      <div className="flex items-center gap-2 pt-2 mt-2 border-t border-white/5">
        <span className="text-[9px] tracking-widest uppercase text-slate/70">
          {showCursor ? 'composing' : 'idle'}
        </span>
        <span className="flex-1 h-px bg-white/5" />
        <span className="text-[9px] tracking-widest uppercase text-slate/70">
          {step + 1}/{CHAT_SCRIPT.length}
        </span>
      </div>
    </div>
  );
}

// ---------- Sim 02 — FlowSim: nodes connected with pulses flowing ----------
function FlowSim({ active }: { active: boolean }) {
  const [pulse, setPulse] = useState(0);
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setPulse((p) => (p + 1) % 100), 50);
    return () => clearInterval(id);
  }, [active]);

  // 4-node pipeline: SOURCE → AGENT → ACTION → DELIVER
  const nodes = [
    { x: 40,  y: 60, label: 'INPUT'   },
    { x: 130, y: 60, label: 'AGENT'   },
    { x: 220, y: 30, label: 'EMAIL'   },
    { x: 220, y: 90, label: 'CRM'     },
  ];

  // pulse positions traveling along links (cycle through 0-1 progress)
  const links = [
    { from: 0, to: 1 },
    { from: 1, to: 2 },
    { from: 1, to: 3 },
  ];

  return (
    <svg viewBox="0 0 280 130" className="w-full h-full" aria-hidden="true">
      {/* Links */}
      {links.map((l, i) => {
        const a = nodes[l.from];
        const b = nodes[l.to];
        const progress = ((pulse + i * 25) % 100) / 100;
        const px = a.x + (b.x - a.x) * progress;
        const py = a.y + (b.y - a.y) * progress;
        return (
          <g key={i}>
            <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#2563EB" strokeWidth="0.6" opacity="0.4" />
            <circle cx={px} cy={py} r="2" fill="#2563EB">
              <animate attributeName="opacity" values="0.3;1;0.3" dur="0.8s" repeatCount="indefinite" />
            </circle>
          </g>
        );
      })}
      {/* Nodes */}
      {nodes.map((n, i) => (
        <g key={i}>
          <rect
            x={n.x - 30}
            y={n.y - 14}
            width="60"
            height="28"
            stroke="#2563EB"
            strokeWidth="0.9"
            fill={i === 1 ? 'rgba(37,99,235,0.10)' : 'none'}
          />
          <text
            x={n.x}
            y={n.y + 5}
            fill={i === 1 ? '#FAF8F3' : '#94A3B8'}
            fontSize="14"
            fontFamily="monospace"
            textAnchor="middle"
            letterSpacing="0.6"
            fontWeight="500"
          >
            {n.label}
          </text>
        </g>
      ))}
    </svg>
  );
}

// ---------- Sim 03 — SiteSim: wireframe site with pulsing agent hotspots ----------
function SiteSim({ active }: { active: boolean }) {
  return (
    <svg viewBox="0 0 280 130" className="w-full h-full" aria-hidden="true">
      {/* Browser frame */}
      <rect x="8" y="8" width="264" height="114" stroke="#2563EB" strokeWidth="0.6" fill="rgba(37,99,235,0.03)" />

      {/* Animated pulse trace around frame — glow layer */}
      <rect
        x="8" y="8" width="264" height="114"
        fill="none"
        stroke="#2563EB"
        strokeWidth="3"
        strokeDasharray="55 701"
        strokeLinecap="round"
        opacity="0.35"
        style={{ filter: 'blur(2px)' }}
      >
        <animate
          attributeName="stroke-dashoffset"
          from="0"
          to="-756"
          dur="3.2s"
          repeatCount="indefinite"
        />
      </rect>
      {/* Animated pulse trace — bright leading edge */}
      <rect
        x="8" y="8" width="264" height="114"
        fill="none"
        stroke="#FAF8F3"
        strokeWidth="1.2"
        strokeDasharray="55 701"
        strokeLinecap="round"
      >
        <animate
          attributeName="stroke-dashoffset"
          from="0"
          to="-756"
          dur="3.2s"
          repeatCount="indefinite"
        />
      </rect>

      {/* Header bar */}
      <line x1="8" y1="22" x2="272" y2="22" stroke="#2563EB" strokeWidth="0.4" opacity="0.5" />
      <circle cx="14" cy="15" r="1.6" fill="#475569" />
      <circle cx="20" cy="15" r="1.6" fill="#475569" />
      <circle cx="26" cy="15" r="1.6" fill="#475569" />
      {/* Hero area */}
      <rect x="18" y="32" width="120" height="40" stroke="#2563EB" strokeWidth="0.4" fill="none" opacity="0.5" />
      <line x1="22" y1="42" x2="80" y2="42" stroke="#FAF8F3" strokeWidth="0.6" opacity="0.7" />
      <line x1="22" y1="48" x2="70" y2="48" stroke="#FAF8F3" strokeWidth="0.6" opacity="0.5" />
      {/* CTA button */}
      <rect x="22" y="56" width="26" height="9" fill="#2563EB" opacity="0.8" />
      {/* Cards */}
      <rect x="148" y="32" width="38" height="38" stroke="#2563EB" strokeWidth="0.4" fill="none" opacity="0.4" />
      <rect x="192" y="32" width="38" height="38" stroke="#2563EB" strokeWidth="0.4" fill="none" opacity="0.4" />
      <rect x="236" y="32" width="28" height="38" stroke="#2563EB" strokeWidth="0.4" fill="none" opacity="0.4" />
      {/* Bottom row */}
      <line x1="18" y1="84" x2="180" y2="84" stroke="#FAF8F3" strokeWidth="0.4" opacity="0.3" />
      <line x1="18" y1="92" x2="220" y2="92" stroke="#FAF8F3" strokeWidth="0.4" opacity="0.3" />
      <line x1="18" y1="100" x2="160" y2="100" stroke="#FAF8F3" strokeWidth="0.4" opacity="0.3" />
      {/* Agent hotspots */}
      <g>
        <circle cx="167" cy="51" r="2.5" fill="#2563EB">
          <animate attributeName="r" values="2.5;4;2.5" dur="2s" repeatCount="indefinite" />
          <animate attributeName="opacity" values="1;0.4;1" dur="2s" repeatCount="indefinite" />
        </circle>
        <circle cx="250" cy="110" r="2.5" fill="#2563EB">
          <animate attributeName="r" values="2.5;4;2.5" dur="2.4s" begin="0.5s" repeatCount="indefinite" />
          <animate attributeName="opacity" values="1;0.4;1" dur="2.4s" begin="0.5s" repeatCount="indefinite" />
        </circle>
        <circle cx="35" cy="60" r="2" fill="#2563EB">
          <animate attributeName="r" values="2;3.5;2" dur="1.7s" begin="0.8s" repeatCount="indefinite" />
          <animate attributeName="opacity" values="1;0.4;1" dur="1.7s" begin="0.8s" repeatCount="indefinite" />
        </circle>
      </g>
    </svg>
  );
}

// ---------- Stack glyph: three thin horizontal lines, active line highlighted ----------
function StackGlyph({
  activeIndex,
  visible,
  baseDelay,
}: {
  activeIndex: 0 | 1 | 2;
  visible: boolean;
  baseDelay: number;
}) {
  return (
    <span
      className="inline-flex flex-col gap-[2px] mr-3 align-middle"
      aria-hidden="true"
      style={{ width: 14 }}
    >
      {[0, 1, 2].map((i) => {
        const isActive = i === activeIndex;
        // Per-line entrance stagger: L1 first, then L2, then L3
        const lineDelay = baseDelay + i * 90;
        return (
          <span
            key={i}
            className="block h-[1.5px] origin-left"
            style={{
              width: '100%',
              backgroundColor: isActive ? '#2563EB' : '#475569',
              opacity: isActive ? 1 : 0.55,
              transform: visible ? 'scaleX(1)' : 'scaleX(0)',
              transition: `transform 0.45s cubic-bezier(0.16, 1, 0.3, 1) ${lineDelay}ms`,
            }}
          />
        );
      })}
    </span>
  );
}

// Layer label: glyph + "L1 · AGENTS"
function LayerLabel({
  code,
  tag,
  activeIndex,
  visible,
  baseDelay,
}: {
  code: string;
  tag: string;
  activeIndex: 0 | 1 | 2;
  visible: boolean;
  baseDelay: number;
}) {
  return (
    <span className="inline-flex items-center group/label">
      <StackGlyph activeIndex={activeIndex} visible={visible} baseDelay={baseDelay} />
      <span className="font-mono text-[11px] tracking-widest uppercase text-slate group-hover/label:text-electric transition-colors duration-300">
        {code} · {tag}
      </span>
    </span>
  );
}

// ---------- Pillar card with 3D tilt + scroll reveal ----------
type Pillar = {
  code: string;
  tag: string;
  layerIndex: 0 | 1 | 2;
  label: string;
  headline: string;
  body: string;
  Sim: React.FC<{ active: boolean }>;
};

function PillarCard({
  pillar,
  layout,
  visible,
  delay,
}: {
  pillar: Pillar;
  layout: 'tall' | 'wide-text' | 'wide-split';
  visible: boolean;
  delay: number;
}) {
  const ref = useRef<HTMLElement>(null);
  const [tilt, setTilt] = useState({ x: 0, y: 0 });
  const [active, setActive] = useState(false);

  const handleMove = (e: React.MouseEvent) => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const dx = ((e.clientX - r.left) / r.width - 0.5) * 2;
    const dy = ((e.clientY - r.top) / r.height - 0.5) * 2;
    setTilt({ x: -dy * 4, y: dx * 4 });
  };

  const handleLeave = () => {
    setActive(false);
    setTilt({ x: 0, y: 0 });
  };

  const Sim = pillar.Sim;

  const cardStyle: React.CSSProperties = {
    transform: `perspective(1200px) rotateX(${tilt.x}deg) rotateY(${tilt.y}deg) translateY(${visible ? 0 : 24}px)`,
    transition: active
      ? `transform 0.1s ease-out, opacity 0.6s ease-out ${delay}ms`
      : `transform 0.6s cubic-bezier(0.16, 1, 0.3, 1) ${delay}ms, opacity 0.6s ease-out ${delay}ms`,
    opacity: visible ? 1 : 0,
    transformStyle: 'preserve-3d',
  };

  return (
    <article
      ref={ref}
      onMouseMove={handleMove}
      onMouseEnter={() => setActive(true)}
      onMouseLeave={handleLeave}
      style={cardStyle}
      className={`relative group bg-navy overflow-hidden ${
        layout === 'tall'
          ? 'md:col-span-5 p-10 md:p-12 min-h-[520px] flex flex-col justify-between'
          : 'p-10 md:p-12 min-h-[250px]'
      }`}
    >
      {/* Subtle gradient sheen on hover */}
      <div
        className="pointer-events-none absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-700"
        style={{
          background:
            'radial-gradient(ellipse 60% 80% at var(--mx, 50%) var(--my, 0%), rgba(37,99,235,0.10) 0%, transparent 60%)',
        }}
        aria-hidden="true"
      />

      {/* Top row: stack-layer label + accent line */}
      <div className="flex items-center justify-between relative z-10">
        <LayerLabel
          code={pillar.code}
          tag={pillar.tag}
          activeIndex={pillar.layerIndex}
          visible={visible}
          baseDelay={delay + 200}
        />
        <span className="h-px w-6 bg-electric/50 group-hover:w-16 transition-all duration-500" />
      </div>

      {layout === 'tall' ? (
        <>
          {/* Big title */}
          <div className="relative z-10 my-8">
            <h3 className="text-5xl md:text-6xl font-bold tracking-tight text-cream leading-none">
              <MagneticText text={pillar.label} />
            </h3>
            <p className="mt-6 text-base text-slate leading-relaxed max-w-xs">
              {pillar.body}
            </p>
          </div>
          {/* Live sim panel */}
          <div className="relative z-10 mt-auto h-56 md:h-64 border border-white/5 bg-black/30 p-4 flex">
            <div className="w-full self-stretch overflow-hidden">
              <Sim active={visible} />
            </div>
          </div>
        </>
      ) : layout === 'wide-text' ? (
        <div className="relative z-10 flex flex-col md:flex-row gap-8 h-full items-stretch">
          <div className="flex-1">
            <h3 className="mt-3 text-3xl md:text-4xl font-bold tracking-tight text-cream leading-tight max-w-md">
              <MagneticText text={pillar.headline} />
            </h3>
            <p className="mt-4 text-sm text-slate leading-relaxed max-w-sm">
              {pillar.body}
            </p>
          </div>
          {/* Live sim */}
          <div className="md:w-[200px] shrink-0 border border-white/5 bg-black/30 p-3 flex min-h-[120px]">
            <div className="w-full self-stretch">
              <Sim active={visible} />
            </div>
          </div>
        </div>
      ) : (
        <div className="relative z-10 flex flex-col md:flex-row md:items-end md:justify-between gap-8 h-full">
          <div className="flex-1">
            <h3 className="mt-3 text-3xl md:text-4xl font-bold tracking-tight text-cream leading-tight max-w-xs">
              <MagneticText text={pillar.headline} />
            </h3>
          </div>
          <div className="md:w-[260px] shrink-0 flex flex-col gap-4">
            <div className="border border-white/5 bg-black/30 p-3 flex min-h-[100px]">
              <div className="w-full self-stretch">
                <Sim active={visible} />
              </div>
            </div>
            <p className="text-xs text-slate leading-relaxed">
              {pillar.body}
            </p>
          </div>
        </div>
      )}
    </article>
  );
}

const PILLARS: Pillar[] = [
  {
    code: 'L1',
    tag: 'AGENTS',
    layerIndex: 0,
    label: 'AI Agents',
    headline: 'Systems that work without anyone in the room.',
    body: 'Chat, voice, booking, qualification, follow-up — we build agents that handle real conversations with real prospects, automatically.',
    Sim: AgentSim,
  },
  {
    code: 'L2',
    tag: 'SYSTEMS',
    layerIndex: 1,
    label: 'Automation Systems',
    headline: 'Workflows that replace manual tasks entirely.',
    body: 'From lead intake to delivery confirmation, we map your operations and build the automation layer that runs it without you.',
    Sim: FlowSim,
  },
  {
    code: 'L3',
    tag: 'INTERFACES',
    layerIndex: 2,
    label: 'AI-Native Websites',
    headline: 'Sites with agents built in, not bolted on.',
    body: 'Not a chatbot in the corner. Intelligent interfaces that qualify, convert, and follow up — built into the site from day one.',
    Sim: SiteSim,
  },
];

export default function Pillars() {
  const sectionRef = useRef<HTMLElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = sectionRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      (entries) => entries.forEach((e) => e.isIntersecting && setVisible(true)),
      { threshold: 0.15 }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  return (
    <section ref={sectionRef} className="px-6 md:px-16 py-32 max-w-7xl mx-auto">

      {/* Section header */}
      <div className="mb-20 md:mb-24 flex flex-col gap-6">
        {/* Top eyebrow row */}
        <div
          className="flex items-center gap-4 transition-all duration-700"
          style={{ opacity: visible ? 1 : 0, transform: visible ? 'translateY(0)' : 'translateY(20px)' }}
        >
          <span className="h-px w-10 bg-electric" />
          <span className="font-mono text-[11px] tracking-[0.25em] uppercase text-electric">
            // What We Build
          </span>
        </div>

        {/* Massive editorial headline */}
        <h2
          className="text-5xl md:text-7xl lg:text-[5.5rem] font-bold tracking-tight text-cream leading-[0.95] max-w-4xl transition-all duration-700"
          style={{
            opacity: visible ? 1 : 0,
            transform: visible ? 'translateY(0)' : 'translateY(30px)',
            transitionDelay: '120ms',
          }}
        >
          <MagneticText text="Three layers." />
          <br />
          <span className="text-electric">
            <MagneticText text="One system." />
          </span>
        </h2>

        {/* Supporting subhead */}
        <p
          className="text-base md:text-lg text-slate max-w-xl leading-relaxed transition-all duration-700"
          style={{
            opacity: visible ? 1 : 0,
            transform: visible ? 'translateY(0)' : 'translateY(20px)',
            transitionDelay: '240ms',
          }}
        >
          Every <Brand /> build runs on the same architecture — three connected layers that turn manual work into an automated stack.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-12 gap-px bg-white/5">
        {/* Pillar 01 — tall left */}
        <PillarCard pillar={PILLARS[0]} layout="tall" visible={visible} delay={0} />

        {/* Right column */}
        <div className="md:col-span-7 flex flex-col gap-px">
          <PillarCard pillar={PILLARS[1]} layout="wide-text" visible={visible} delay={150} />
          <PillarCard pillar={PILLARS[2]} layout="wide-split" visible={visible} delay={300} />
        </div>
      </div>
    </section>
  );
}
