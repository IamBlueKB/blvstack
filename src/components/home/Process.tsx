import { useEffect, useRef, useState } from 'react';
import MagneticText from './MagneticText';

// ---------- Simulator 01 — Audit Heatmap Scanner ----------
// Dense cell grid where hot cells (bottlenecks) glow. A scanner line sweeps
// across at ~3.7s cadence; cells near the scanner briefly intensify.

const AUDIT_HOT_CELLS = [
  { x: 2,  y: 1, intensity: 0.62 },
  { x: 5,  y: 3, intensity: 0.92 },
  { x: 7,  y: 0, intensity: 0.42 },
  { x: 9,  y: 5, intensity: 0.74 },
  { x: 11, y: 2, intensity: 0.55 },
  { x: 3,  y: 5, intensity: 0.36 },
  { x: 12, y: 4, intensity: 0.80 },
  { x: 6,  y: 6, intensity: 0.50 },
];

function AuditSim({ active }: { active: boolean }) {
  const [scanPos, setScanPos] = useState(0);

  useEffect(() => {
    if (!active) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      // Scanner travels 0 → 1.3 over ~3.7s, then loops; the 0.3 overflow keeps
      // it offscreen briefly between sweeps for breathing room
      setScanPos((p) => (p + dt * 0.35) % 1.3);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active]);

  const COLS = 14;
  const ROWS = 7;
  const CELL = 14;
  const GAP = 2;
  const W = COLS * (CELL + GAP) - GAP;
  const H = ROWS * (CELL + GAP) - GAP;
  const PAD = 4;
  const VBW = W + PAD * 2;
  const VBH = H + PAD * 2;

  const scannerX = scanPos * W + PAD;
  const scannerVisible = scanPos <= 1.0;

  return (
    <div className="relative w-full h-full flex flex-col">
      {/* HUD top bar */}
      <div className="flex items-center justify-between mb-2 font-mono text-[9px] tracking-widest uppercase">
        <span className="flex items-center gap-1.5 text-electric">
          <span className="relative flex w-1.5 h-1.5">
            <span className="absolute inset-0 rounded-full bg-electric animate-ping opacity-75" />
            <span className="relative w-1.5 h-1.5 rounded-full bg-electric" />
          </span>
          Scanning
        </span>
        <span className="text-slate/60">
          Findings · <span className="text-cream">{String(AUDIT_HOT_CELLS.length).padStart(2, '0')}</span>
        </span>
      </div>

      {/* Heatmap */}
      <div className="flex-1 flex items-center justify-center min-h-0">
        <svg viewBox={`0 0 ${VBW} ${VBH}`} className="w-full h-full" preserveAspectRatio="xMidYMid meet">
          <defs>
            <linearGradient id="scannerGrad" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#2563EB" stopOpacity="0" />
              <stop offset="50%" stopColor="#2563EB" stopOpacity="0.9" />
              <stop offset="100%" stopColor="#2563EB" stopOpacity="0" />
            </linearGradient>
          </defs>

          {/* Corner brackets for technical frame feel */}
          {[
            [0, 0, 1, 1],
            [VBW, 0, -1, 1],
            [0, VBH, 1, -1],
            [VBW, VBH, -1, -1],
          ].map(([x, y, sx, sy], i) => (
            <g key={i} stroke="#475569" strokeWidth="0.6" fill="none">
              <line x1={x} y1={y} x2={x + 5 * sx} y2={y} />
              <line x1={x} y1={y} x2={x} y2={y + 5 * sy} />
            </g>
          ))}

          {/* Grid cells */}
          {Array.from({ length: ROWS }).map((_, y) =>
            Array.from({ length: COLS }).map((_, x) => {
              const cx = PAD + x * (CELL + GAP);
              const cy = PAD + y * (CELL + GAP);
              const hot = AUDIT_HOT_CELLS.find((h) => h.x === x && h.y === y);
              const baseHeat = hot ? hot.intensity : 0;
              const ambient = hot ? 0 : 0.08;

              // Proximity boost when scanner passes
              const cellCenterX = cx + CELL / 2;
              const dist = Math.abs(cellCenterX - scannerX);
              const proxBoost = scannerVisible && dist < 12 ? (1 - dist / 12) : 0;

              const heatFinal = Math.min(baseHeat + proxBoost * 0.5, 1);
              const fill = hot
                ? `rgba(37,99,235,${heatFinal})`
                : `rgba(148,163,184,${ambient + proxBoost * 0.18})`;

              return (
                <rect
                  key={`${x}-${y}`}
                  x={cx}
                  y={cy}
                  width={CELL}
                  height={CELL}
                  fill={fill}
                  rx="0.5"
                />
              );
            })
          )}

          {/* Scanner sweep — vertical line with gradient halo */}
          {scannerVisible && (
            <>
              <rect
                x={scannerX - 8}
                y={PAD}
                width="16"
                height={H}
                fill="url(#scannerGrad)"
                opacity="0.6"
              />
              <line
                x1={scannerX}
                y1={PAD}
                x2={scannerX}
                y2={PAD + H}
                stroke="#FAF8F3"
                strokeWidth="0.6"
                opacity="0.9"
              />
            </>
          )}
        </svg>
      </div>

      {/* Bottom HUD */}
      <div className="flex items-center justify-between mt-2 font-mono text-[9px] tracking-widest uppercase text-slate/70">
        <span>Audit · Sector 04</span>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-px bg-slate/50" />
          v1.0
        </span>
      </div>
    </div>
  );
}

// ---------- Simulator 02 — Design Blueprint Schematic ----------
// Central abstract form with 3 numbered callouts (○1 ○2 ○3) that draw in
// sequentially with dashed lines pointing to features.

function DesignSim({ active }: { active: boolean }) {
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (!active) return;
    let i = 0;
    const id = setInterval(() => {
      i = (i + 1) % 8; // 0=blank, 1/2/3=callouts appear, 4-7=hold
      setStep(i);
    }, 700);
    return () => clearInterval(id);
  }, [active]);

  const shown = (n: number) => step >= n;

  return (
    <div className="relative w-full h-full flex flex-col">
      {/* HUD top */}
      <div className="flex items-center justify-between mb-2 font-mono text-[9px] tracking-widest uppercase">
        <span className="text-electric">Spec · v1.3</span>
        <span className="text-slate/60">
          Annotations · <span className="text-cream">03</span>
        </span>
      </div>

      {/* Blueprint SVG */}
      <div className="flex-1 flex items-center justify-center min-h-0">
        <svg viewBox="0 0 240 130" className="w-full h-full" preserveAspectRatio="xMidYMid meet">
          <defs>
            <pattern id="bpGrid" x="0" y="0" width="10" height="10" patternUnits="userSpaceOnUse">
              <path d="M 10 0 L 0 0 0 10" fill="none" stroke="#475569" strokeWidth="0.2" opacity="0.4" />
            </pattern>
          </defs>

          {/* Blueprint background */}
          <rect x="0" y="0" width="240" height="130" fill="url(#bpGrid)" />

          {/* Corner dimension marks */}
          <g stroke="#94A3B8" strokeWidth="0.5" fill="none" opacity="0.6">
            <path d="M 4 10 L 4 4 L 10 4" />
            <path d="M 230 4 L 236 4 L 236 10" />
            <path d="M 4 120 L 4 126 L 10 126" />
            <path d="M 230 126 L 236 126 L 236 120" />
          </g>

          {/* Center crosshair guides (very faint) */}
          <line x1="120" y1="20" x2="120" y2="110" stroke="#2563EB" strokeWidth="0.3" opacity="0.2" strokeDasharray="1 3" />
          <line x1="40" y1="65" x2="200" y2="65" stroke="#2563EB" strokeWidth="0.3" opacity="0.2" strokeDasharray="1 3" />

          {/* Central geometric form */}
          <g stroke="#2563EB" fill="none">
            <rect x="80" y="40" width="80" height="50" strokeWidth="0.9" />
            <line x1="80" y1="55" x2="160" y2="55" strokeWidth="0.4" opacity="0.5" />
            <rect x="90" y="62" width="60" height="20" strokeWidth="0.5" opacity="0.5" />
            <circle cx="120" cy="72" r="3" fill="#2563EB" stroke="none" opacity="0.7" />
          </g>

          {/* Spec dimension annotation */}
          <g stroke="#475569" strokeWidth="0.3" fill="#94A3B8" opacity="0.7">
            <line x1="80" y1="34" x2="160" y2="34" />
            <line x1="80" y1="32" x2="80" y2="36" />
            <line x1="160" y1="32" x2="160" y2="36" />
            <text x="120" y="30" fontSize="5.5" fontFamily="monospace" textAnchor="middle" fill="#94A3B8" letterSpacing="0.5">80u</text>
          </g>

          {/* Callout 1 — top left → form left edge */}
          <g style={{ opacity: shown(1) ? 1 : 0, transition: 'opacity 0.45s' }}>
            <line x1="38" y1="22" x2="80" y2="48" stroke="#2563EB" strokeWidth="0.5" strokeDasharray="2 2" opacity="0.7" />
            <circle cx="34" cy="22" r="6" fill="#0A1628" stroke="#2563EB" strokeWidth="0.8" />
            <text x="34" y="24.5" fill="#2563EB" fontSize="6.5" fontFamily="monospace" textAnchor="middle" fontWeight="600">01</text>
            <text x="14" y="14" fill="#94A3B8" fontSize="6" fontFamily="monospace" letterSpacing="0.6">INPUT</text>
          </g>

          {/* Callout 2 — top right → form right edge */}
          <g style={{ opacity: shown(2) ? 1 : 0, transition: 'opacity 0.45s' }}>
            <line x1="206" y1="28" x2="160" y2="48" stroke="#2563EB" strokeWidth="0.5" strokeDasharray="2 2" opacity="0.7" />
            <circle cx="210" cy="28" r="6" fill="#0A1628" stroke="#2563EB" strokeWidth="0.8" />
            <text x="210" y="30.5" fill="#2563EB" fontSize="6.5" fontFamily="monospace" textAnchor="middle" fontWeight="600">02</text>
            <text x="200" y="18" fill="#94A3B8" fontSize="6" fontFamily="monospace" letterSpacing="0.6">LOGIC</text>
          </g>

          {/* Callout 3 — bottom center → form center */}
          <g style={{ opacity: shown(3) ? 1 : 0, transition: 'opacity 0.45s' }}>
            <line x1="120" y1="106" x2="120" y2="92" stroke="#2563EB" strokeWidth="0.5" strokeDasharray="2 2" opacity="0.7" />
            <circle cx="120" cy="112" r="6" fill="#0A1628" stroke="#2563EB" strokeWidth="0.8" />
            <text x="120" y="114.5" fill="#2563EB" fontSize="6.5" fontFamily="monospace" textAnchor="middle" fontWeight="600">03</text>
            <text x="130" y="116" fill="#94A3B8" fontSize="6" fontFamily="monospace" letterSpacing="0.6">OUTPUT</text>
          </g>
        </svg>
      </div>

      {/* HUD bottom */}
      <div className="flex items-center justify-between mt-2 font-mono text-[9px] tracking-widest uppercase text-slate/70">
        <span>Design · System.spec</span>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-px bg-slate/50" />
          240 × 130
        </span>
      </div>
    </div>
  );
}

// ---------- Simulator 03 — Build Component Constructor ----------
// A small UI card builds itself in phases: wireframe → placeholders → content → styled.

function BuildSim({ active }: { active: boolean }) {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    if (!active) return;
    let i = 0;
    const id = setInterval(() => {
      i = (i + 1) % 7; // 0=empty 1=outline 2=boxes 3=text 4=button 5-6=hold-styled
      setPhase(i);
    }, 750);
    return () => clearInterval(id);
  }, [active]);

  const showCard = phase >= 1;
  const showBoxes = phase >= 2;
  const showText = phase >= 3;
  const showButton = phase >= 4;
  const isStyled = phase >= 5;

  return (
    <div className="relative w-full h-full flex flex-col">
      {/* HUD top */}
      <div className="flex items-center justify-between mb-2 font-mono text-[9px] tracking-widest uppercase">
        <span className="flex items-center gap-1.5">
          <span className="text-cream">Card.tsx</span>
          <span className="text-slate/60">·</span>
          <span className={isStyled ? 'text-electric' : 'text-electric/60'}>
            {isStyled ? 'Built ✓' : 'Compiling'}
          </span>
        </span>
        <span className="text-slate/60">
          Phase · <span className="text-cream">{String(phase).padStart(2, '0')}</span>/06
        </span>
      </div>

      {/* Component being built */}
      <div className="flex-1 flex items-center justify-center min-h-0 p-2">
        <div
          className="relative w-full max-w-[210px] aspect-[5/3] transition-all duration-500"
          style={{
            opacity: showCard ? 1 : 0,
            borderWidth: '1px',
            borderStyle: showBoxes ? 'solid' : 'dashed',
            borderColor: isStyled ? 'rgba(37,99,235,0.55)' : 'rgba(255,255,255,0.18)',
            backgroundColor: isStyled ? 'rgba(37,99,235,0.05)' : 'transparent',
            boxShadow: isStyled
              ? '0 0 24px rgba(37,99,235,0.25), inset 0 1px 0 rgba(255,255,255,0.06)'
              : 'none',
          }}
        >
          <div className="absolute inset-3 flex flex-col gap-2">
            {/* Header bar */}
            <div
              className="h-2.5 transition-all duration-500 ease-out"
              style={{
                width: showBoxes ? '60%' : '0%',
                backgroundColor: showText
                  ? 'rgba(250,248,243,0.85)'
                  : showBoxes
                  ? 'rgba(255,255,255,0.18)'
                  : 'transparent',
              }}
            />
            {/* Body lines */}
            <div
              className="h-1.5 transition-all duration-500 ease-out"
              style={{
                width: showBoxes ? '88%' : '0%',
                backgroundColor: showText
                  ? 'rgba(148,163,184,0.65)'
                  : showBoxes
                  ? 'rgba(255,255,255,0.10)'
                  : 'transparent',
                transitionDelay: '100ms',
              }}
            />
            <div
              className="h-1.5 transition-all duration-500 ease-out"
              style={{
                width: showBoxes ? '72%' : '0%',
                backgroundColor: showText
                  ? 'rgba(148,163,184,0.65)'
                  : showBoxes
                  ? 'rgba(255,255,255,0.10)'
                  : 'transparent',
                transitionDelay: '160ms',
              }}
            />
            {/* Button — pushed to bottom */}
            <div className="mt-auto flex">
              <div
                className="h-4 transition-all duration-500 ease-out"
                style={{
                  width: showButton ? '54px' : '0%',
                  backgroundColor: showButton ? '#2563EB' : 'transparent',
                  boxShadow: isStyled ? '0 0 12px rgba(37,99,235,0.5)' : 'none',
                }}
              />
            </div>
          </div>

          {/* Wireframe corner marks (visible only during early phases) */}
          {showCard && !isStyled && (
            <>
              {[
                [0, 0, 1, 1],
                ['100%', 0, -1, 1],
                [0, '100%', 1, -1],
                ['100%', '100%', -1, -1],
              ].map(([x, y, sx, sy], i) => (
                <div
                  key={i}
                  className="absolute"
                  style={{
                    left: typeof x === 'number' ? x : x,
                    top: typeof y === 'number' ? y : y,
                    width: 4,
                    height: 4,
                    borderLeft: (sx as number) > 0 ? '1px solid rgba(37,99,235,0.7)' : undefined,
                    borderRight: (sx as number) < 0 ? '1px solid rgba(37,99,235,0.7)' : undefined,
                    borderTop: (sy as number) > 0 ? '1px solid rgba(37,99,235,0.7)' : undefined,
                    borderBottom: (sy as number) < 0 ? '1px solid rgba(37,99,235,0.7)' : undefined,
                    transform: `translate(${(sx as number) < 0 ? -100 : 0}%, ${(sy as number) < 0 ? -100 : 0}%)`,
                  }}
                />
              ))}
            </>
          )}
        </div>
      </div>

      {/* HUD bottom */}
      <div className="flex items-center justify-between mt-2 font-mono text-[9px] tracking-widest uppercase text-slate/70">
        <span>Build · React 19</span>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-px bg-slate/50" />
          ts:strict
        </span>
      </div>
    </div>
  );
}

// ---------- Simulator 04 — Deploy Pre-flight Checklist ----------
// 4 items each cycle queued → running → complete in cascade. Brief
// "ALL SYSTEMS LIVE" flash at end, then loops.

const PREFLIGHT_ITEMS = [
  'env vars synced',
  'tests passing',
  'build complete',
  'deployment live',
];

function DeploySim({ active }: { active: boolean }) {
  const [states, setStates] = useState<number[]>([0, 0, 0, 0]);
  const [progress, setProgress] = useState(0);
  const [showLive, setShowLive] = useState(false);

  useEffect(() => {
    if (!active) return;
    const timeouts: number[] = [];

    const run = () => {
      setStates([0, 0, 0, 0]);
      setProgress(0);
      setShowLive(false);

      [0, 1, 2, 3].forEach((idx) => {
        const startRunning = idx * 700 + 350;
        const startComplete = startRunning + 480;
        timeouts.push(
          window.setTimeout(() => {
            setStates((s) => s.map((v, i) => (i === idx ? 1 : v)));
          }, startRunning),
          window.setTimeout(() => {
            setStates((s) => s.map((v, i) => (i === idx ? 2 : v)));
            setProgress(((idx + 1) / 4) * 100);
          }, startComplete),
        );
      });

      timeouts.push(
        window.setTimeout(() => setShowLive(true), 3600),
        window.setTimeout(() => run(), 6200),
      );
    };

    run();
    return () => { timeouts.forEach((t) => clearTimeout(t)); };
  }, [active]);

  return (
    <div className="relative w-full h-full flex flex-col">
      {/* HUD top */}
      <div className="flex items-center justify-between mb-2 font-mono text-[9px] tracking-widest uppercase">
        <span className="flex items-center gap-1.5">
          <span className="relative flex w-1.5 h-1.5">
            <span className={`absolute inset-0 rounded-full animate-ping opacity-75 ${showLive ? 'bg-electric' : 'bg-slate/50'}`} />
            <span className={`relative w-1.5 h-1.5 rounded-full ${showLive ? 'bg-electric' : 'bg-slate/60'}`} />
          </span>
          <span className={showLive ? 'text-electric' : 'text-slate/70'}>
            {showLive ? 'Live' : 'Deploy · prod'}
          </span>
        </span>
        <span className="text-slate/60">
          Pre-flight · <span className="text-cream">{Math.round(progress)}%</span>
        </span>
      </div>

      {/* Checklist */}
      <div className="flex-1 flex flex-col justify-center gap-2 min-h-0">
        {PREFLIGHT_ITEMS.map((item, i) => {
          const state = states[i];
          const symbol = state === 0 ? '[ ]' : state === 1 ? '[•]' : '[✓]';
          const symbolColor =
            state === 2 ? 'text-electric' : state === 1 ? 'text-cream' : 'text-slate/60';
          const labelColor =
            state === 0 ? 'text-slate/60' : state === 1 ? 'text-cream/90' : 'text-cream/80';
          const statusText = state === 0 ? 'queued' : state === 1 ? 'running' : 'complete';
          const statusColor = state === 2 ? 'text-electric/80' : 'text-slate/60';
          return (
            <div key={i} className="flex items-center justify-between font-mono text-[10px] leading-tight">
              <span className="flex items-center gap-2">
                <span className={`${symbolColor} ${state === 1 ? 'animate-pulse' : ''}`}>
                  {symbol}
                </span>
                <span className={`${labelColor} transition-colors duration-300`}>{item}</span>
              </span>
              <span className={`text-[8.5px] tracking-widest uppercase ${statusColor} transition-colors duration-300`}>
                {statusText}
              </span>
            </div>
          );
        })}
      </div>

      {/* Progress bar */}
      <div className="w-full h-px bg-white/10 overflow-hidden mt-3">
        <div
          className="h-full bg-electric transition-all duration-300"
          style={{ width: `${progress}%` }}
        />
      </div>

      {/* HUD bottom */}
      <div className="flex items-center justify-between mt-2 font-mono text-[9px] tracking-widest uppercase">
        <span className={showLive ? 'text-electric' : 'text-slate/70'}>
          {showLive ? '// all systems live' : 'Deploy · pipeline'}
        </span>
        <span className="flex items-center gap-1.5 text-slate/70">
          <span className="w-3 h-px bg-slate/50" />
          v1.0
        </span>
      </div>
    </div>
  );
}

// ---------- Phase glyph: 4 horizontal dots, active one highlighted ----------
function PhaseGlyph({ phaseIndex, visible }: { phaseIndex: 0 | 1 | 2 | 3; visible: boolean }) {
  return (
    <span className="inline-flex items-center gap-1 mr-3 align-middle" aria-hidden="true">
      {[0, 1, 2, 3].map((i) => {
        const isActive = i === phaseIndex;
        const isPast = i < phaseIndex;
        return (
          <span
            key={i}
            className="block rounded-full"
            style={{
              width: isActive ? '8px' : '4px',
              height: isActive ? '8px' : '4px',
              backgroundColor: isActive ? '#2563EB' : isPast ? '#475569' : '#475569',
              opacity: visible ? (isActive ? 1 : isPast ? 0.7 : 0.4) : 0,
              transform: visible ? 'scale(1)' : 'scale(0)',
              transition: `all 0.4s cubic-bezier(0.16, 1, 0.3, 1) ${i * 80}ms`,
            }}
          />
        );
      })}
    </span>
  );
}

// ---------- Main Process section ----------
const STEPS = [
  { code: 'P1', tag: 'AUDIT',  phaseIndex: 0 as const, label: 'Audit',  body: 'We map your workflow, find the bottlenecks worth fixing, and quantify what they cost you weekly.', sim: AuditSim  },
  { code: 'P2', tag: 'DESIGN', phaseIndex: 1 as const, label: 'Design', body: 'A system diagram of the agents, integrations, and data flows we will build — reviewed before any code.', sim: DesignSim },
  { code: 'P3', tag: 'BUILD',  phaseIndex: 2 as const, label: 'Build',  body: 'Production code, custom for your stack. No no-code duct tape, no platform lock-in, fully owned by you.', sim: BuildSim  },
  { code: 'P4', tag: 'DEPLOY', phaseIndex: 3 as const, label: 'Deploy', body: 'Live to production with monitoring, fallbacks, and a handover doc. We stay on call through week one.', sim: DeploySim },
];

export default function Process() {
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

      {/* Section header — matches What We Build treatment */}
      <div className="mb-20 md:mb-24 flex flex-col gap-6">
        {/* Eyebrow row */}
        <div
          className="flex items-center gap-4 transition-all duration-700"
          style={{ opacity: visible ? 1 : 0, transform: visible ? 'translateY(0)' : 'translateY(20px)' }}
        >
          <span className="h-px w-10 bg-electric" />
          <span className="font-mono text-[11px] tracking-[0.25em] uppercase text-electric">
            // How We Work
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
          <MagneticText text="Four phases." />
          <br />
          <span className="text-electric">
            <MagneticText text="No mystery." />
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
          Every build runs the same playbook — audit, design, build, deploy. Predictable timeline, predictable outcomes.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-px bg-white/5">
        {STEPS.map((step, i) => (
          <ProcessCard key={step.code} step={step} visible={visible} delay={i * 120} />
        ))}
      </div>
    </section>
  );
}

// ---------- Process card with 3D tilt + scroll reveal + hover sheen ----------
function ProcessCard({
  step,
  visible,
  delay,
}: {
  step: typeof STEPS[number];
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

  const Sim = step.sim;

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
      className="relative bg-navy overflow-hidden p-8 flex flex-col gap-6 min-h-[420px] group"
    >
      {/* Hover sheen */}
      <div
        className="pointer-events-none absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-700"
        style={{
          background:
            'radial-gradient(ellipse 60% 80% at 50% 0%, rgba(37,99,235,0.10) 0%, transparent 60%)',
        }}
        aria-hidden="true"
      />

      <div className="flex items-center justify-between relative z-10">
        <span className="inline-flex items-center group/label">
          <PhaseGlyph phaseIndex={step.phaseIndex} visible={visible} />
          <span className="font-mono text-[11px] tracking-widest uppercase text-slate group-hover/label:text-electric transition-colors duration-300">
            {step.code} · {step.tag}
          </span>
        </span>
        <span className="w-6 h-px bg-electric/40 group-hover:w-12 group-hover:bg-electric transition-all duration-500" />
      </div>

      <h3 className="text-2xl font-bold text-cream tracking-tight relative z-10">{step.label}</h3>

      <p className="text-sm text-slate leading-relaxed relative z-10">{step.body}</p>

      <div className="mt-auto h-[170px] p-4 bg-black/30 border border-white/5 overflow-hidden flex relative z-10">
        <div className="w-full self-stretch overflow-hidden">
          <Sim active={visible} />
        </div>
      </div>
    </article>
  );
}
