import { useEffect, useRef, useState } from 'react';
import Brand from '../Brand';

type Scenario = {
  id: string;
  q: string;
  tools: string[];           // flickering tool-call lines shown before response
  a: string;                 // streamed response
};

const SCENARIOS: Scenario[] = [
  {
    id: 'businesses',
    q: 'What kind of businesses do you work with?',
    tools: [
      'querying engagement history',
      'matching ideal client profile',
      'composing reply',
    ],
    a: 'BLVSTΛCK builds AI systems for businesses ready to operate at a higher standard. We work with founders, operators, and leadership teams who treat infrastructure as a competitive advantage — not a line item. If you\'re ready to run a tighter system, you\'re our profile.',
  },
  {
    id: 'timeline',
    q: 'How long does a typical build take?',
    tools: [
      'pulling project averages',
      'estimating scope',
      'drafting reply',
    ],
    a: 'Most builds run 2–4 weeks end to end. We do a paid audit week one, design + build weeks two and three, then deploy and hand over with monitoring in week four. Bigger systems can stretch to 6 weeks but we always scope before we start.',
  },
  {
    id: 'pricing',
    q: 'What does pricing look like?',
    tools: [
      'checking tier definitions',
      'pulling current rates',
      'drafting reply',
    ],
    a: 'I don\'t share specific numbers here — pricing depends entirely on scope and integrations. What I can say: most projects land in the $5K–$50K range. To get a real number, you\'d start a project with us and we\'d hop on a 20-minute discovery call.',
  },
];

type Message =
  | { role: 'user'; text: string }
  | { role: 'agent'; tools: string[]; text: string; streamedChars: number; toolIndex: number };

function streamingChar(intervalMs = 14) {
  return intervalMs;
}

export default function SimChatAgent() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [askedIds, setAskedIds] = useState<Set<string>>(new Set());
  const scrollRef = useRef<HTMLDivElement>(null);

  // Open via global event from Hero button
  useEffect(() => {
    const handler = () => {
      setOpen(true);
      if (messages.length === 0) {
        setMessages([
          {
            role: 'agent',
            tools: [],
            text: 'Hey — I\'m the BLVSTΛCK demo agent. Pick a question below to see how I respond, or check out our work.',
            streamedChars: 0,
            toolIndex: -1,
          },
        ]);
      }
    };
    window.addEventListener('open-chat', handler);
    return () => window.removeEventListener('open-chat', handler);
  }, [messages.length]);

  // Animate streaming of the last agent message
  useEffect(() => {
    const last = messages[messages.length - 1];
    if (!last || last.role !== 'agent') return;
    if (last.streamedChars >= last.text.length && last.toolIndex >= last.tools.length - 1) return;

    // First: run through tool calls
    if (last.toolIndex < last.tools.length - 1) {
      const id = setTimeout(() => {
        setMessages((prev) => {
          const arr = [...prev];
          const m = { ...(arr[arr.length - 1] as Extract<Message, { role: 'agent' }>) };
          m.toolIndex = m.toolIndex + 1;
          arr[arr.length - 1] = m;
          return arr;
        });
      }, 380);
      return () => clearTimeout(id);
    }

    // Then: stream the response text
    if (last.streamedChars < last.text.length) {
      const id = setTimeout(() => {
        setMessages((prev) => {
          const arr = [...prev];
          const m = { ...(arr[arr.length - 1] as Extract<Message, { role: 'agent' }>) };
          // stream a few chars at a time for a snappier feel
          m.streamedChars = Math.min(m.streamedChars + 3, m.text.length);
          arr[arr.length - 1] = m;
          return arr;
        });
      }, streamingChar());
      return () => clearTimeout(id);
    }
  }, [messages]);

  // Auto-scroll
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages]);

  const ask = (s: Scenario) => {
    if (askedIds.has(s.id)) return;
    setAskedIds((prev) => new Set([...prev, s.id]));
    setMessages((prev) => [
      ...prev,
      { role: 'user', text: s.q },
      { role: 'agent', tools: s.tools, text: s.a, streamedChars: 0, toolIndex: -1 },
    ]);
  };

  const remaining = SCENARIOS.filter((s) => !askedIds.has(s.id));
  const allAsked = remaining.length === 0;

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-end md:items-center justify-end md:justify-end p-0 md:p-6 pointer-events-none">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-navy/60 backdrop-blur-sm pointer-events-auto animate-fade"
        onClick={() => setOpen(false)}
      />

      {/* Panel */}
      <div className="relative w-full md:w-[440px] md:max-w-[90vw] h-[80vh] md:h-[600px] bg-navy border border-electric/20 flex flex-col pointer-events-auto animate-slide-up shadow-2xl">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/5">
          <div className="flex items-center gap-3">
            <span className="relative flex w-2 h-2">
              <span className="absolute inset-0 rounded-full bg-electric animate-ping opacity-75" />
              <span className="relative w-2 h-2 rounded-full bg-electric" />
            </span>
            <p className="font-mono text-[10px] tracking-widest uppercase text-cream">
              <Brand /> Agent · Demo
            </p>
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close chat"
            className="text-slate hover:text-electric transition-colors w-8 h-8 flex items-center justify-center"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M1 1L13 13M13 1L1 13" stroke="currentColor" strokeWidth="1.5" />
            </svg>
          </button>
        </div>

        {/* Messages */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-5 py-6 space-y-5">
          {messages.map((m, i) => {
            if (m.role === 'user') {
              return (
                <div key={i} className="flex justify-end">
                  <div className="max-w-[85%] bg-electric/15 border border-electric/30 text-cream text-sm leading-relaxed px-4 py-2.5">
                    {m.text}
                  </div>
                </div>
              );
            }
            const visibleText = m.text.slice(0, m.streamedChars);
            const showCursor = m.streamedChars < m.text.length;
            const currentToolIdx = m.toolIndex;
            return (
              <div key={i} className="flex flex-col gap-2">
                {/* Tool-use stream */}
                {m.tools.length > 0 && (
                  <div className="space-y-0.5">
                    {m.tools.map((tool, ti) => {
                      if (ti > currentToolIdx) return null;
                      const isLatest = ti === currentToolIdx && currentToolIdx < m.tools.length - 1;
                      return (
                        <p
                          key={ti}
                          className={`font-mono text-[10px] tracking-wide uppercase ${
                            isLatest ? 'text-electric' : 'text-slate/60'
                          }`}
                        >
                          <span className={isLatest ? 'animate-pulse' : ''}>[ {tool}{isLatest ? '...' : ' ✓'} ]</span>
                        </p>
                      );
                    })}
                  </div>
                )}
                {/* Response text */}
                {(m.streamedChars > 0 || m.toolIndex >= m.tools.length - 1) && (
                  <div className="text-sm text-cream/90 leading-relaxed">
                    {visibleText}
                    {showCursor && (
                      <span className="inline-block w-1.5 h-3 bg-electric ml-0.5 align-middle animate-pulse" />
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Suggested questions */}
        <div className="border-t border-white/5 px-5 py-4 space-y-2">
          {!allAsked ? (
            <>
              <p className="font-mono text-[9px] tracking-widest uppercase text-slate/60 mb-2">
                Try asking
              </p>
              {remaining.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => ask(s)}
                  className="w-full text-left text-xs text-cream/80 hover:text-cream border border-white/10 hover:border-electric/40 px-3 py-2 transition-colors duration-200"
                >
                  {s.q}
                </button>
              ))}
            </>
          ) : (
            <a
              href="/start"
              className="block w-full text-center text-xs font-mono tracking-widest uppercase bg-electric text-cream py-3 hover:bg-royal transition-colors"
            >
              Start a Project →
            </a>
          )}
          <p className="text-[9px] text-slate/60 font-mono tracking-wide pt-1">
            Demo: pre-scripted responses. Real agents are custom built per project.
          </p>
        </div>

      </div>

      <style>{`
        @keyframes fade {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        @keyframes slide-up {
          from { opacity: 0; transform: translateY(20px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .animate-fade { animation: fade 0.3s ease-out forwards; }
        .animate-slide-up { animation: slide-up 0.4s cubic-bezier(0.16, 1, 0.3, 1) forwards; }
      `}</style>
    </div>
  );
}
