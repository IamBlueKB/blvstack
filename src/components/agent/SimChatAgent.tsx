// Live BLVSTACK chat agent — streams responses from /api/agent (Anthropic SDK).
// (File name retained from the original "Sim" placeholder for import compatibility.)

import { useEffect, useRef, useState } from 'react';
import Brand from '../Brand';

type Message = { role: 'user' | 'assistant'; content: string };

const STARTERS = [
  'What kind of businesses do you work with?',
  'How long does a typical build take?',
  'What does pricing look like?',
];

const GREETING: Message = {
  role: 'assistant',
  content:
    "Hey — I'm the BLVSTACK agent. Ask about what we build, timelines, or who we work with. For real pricing or scope, the right next step is /start.",
};

export default function SimChatAgent() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Open via global event from Hero button
  useEffect(() => {
    const handler = () => {
      setOpen(true);
      setMessages((cur) => (cur.length === 0 ? [GREETING] : cur));
      // Focus input shortly after panel opens
      setTimeout(() => inputRef.current?.focus(), 80);
    };
    window.addEventListener('open-chat', handler);
    return () => window.removeEventListener('open-chat', handler);
  }, []);

  // Auto-scroll on new content
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages]);

  // Cancel any inflight request on unmount
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const send = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || streaming) return;
    setError(null);
    setInput('');

    // Append user message to history; this is what we POST.
    const next: Message[] = [...messages, { role: 'user', content: trimmed }];
    setMessages(next);

    // Add an empty assistant placeholder we'll stream chunks into.
    setMessages((cur) => [...cur, { role: 'assistant', content: '' }]);
    setStreaming(true);

    const ac = new AbortController();
    abortRef.current = ac;

    try {
      const res = await fetch('/api/agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: next }),
        signal: ac.signal,
      });

      if (!res.ok || !res.body) {
        const ct = res.headers.get('content-type') ?? '';
        let errMsg = `Request failed (${res.status})`;
        if (ct.includes('application/json')) {
          try {
            const j = await res.json();
            if (j?.error) errMsg = j.error;
          } catch {
            /* ignore */
          }
        }
        setError(errMsg);
        setMessages((cur) => cur.slice(0, -1)); // drop empty assistant placeholder
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        setMessages((cur) => {
          const arr = [...cur];
          arr[arr.length - 1] = { role: 'assistant', content: buf };
          return arr;
        });
      }
    } catch (err: any) {
      if (err?.name !== 'AbortError') {
        setError(err?.message ?? 'Network error');
        setMessages((cur) => cur.slice(0, -1));
      }
    } finally {
      setStreaming(false);
      abortRef.current = null;
      // Refocus input for fast follow-ups
      setTimeout(() => inputRef.current?.focus(), 40);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    send(input);
  };

  if (!open) return null;

  const hasUserMessage = messages.some((m) => m.role === 'user');

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
              <Brand /> Agent · Live
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
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-5 py-6 space-y-4">
          {messages.map((m, i) => {
            if (m.role === 'user') {
              return (
                <div key={i} className="flex justify-end">
                  <div className="max-w-[85%] bg-electric/15 border border-electric/30 text-cream text-sm leading-relaxed px-4 py-2.5 whitespace-pre-wrap break-words">
                    {m.content}
                  </div>
                </div>
              );
            }
            const isLast = i === messages.length - 1;
            const showCursor = streaming && isLast;
            return (
              <div key={i} className="text-sm text-cream/90 leading-relaxed whitespace-pre-wrap break-words">
                {m.content}
                {showCursor && (
                  <span className="inline-block w-1.5 h-3 bg-electric ml-0.5 align-middle animate-pulse" />
                )}
              </div>
            );
          })}
          {error && (
            <p className="font-mono text-[10px] text-red-400/90 tracking-wide">[{error}]</p>
          )}
        </div>

        {/* Starter chips — visible only until the first user message */}
        {!hasUserMessage && (
          <div className="px-5 pb-2 space-y-2">
            <p className="font-mono text-[9px] tracking-widest uppercase text-slate/60">
              Try asking
            </p>
            {STARTERS.map((q) => (
              <button
                key={q}
                type="button"
                onClick={() => send(q)}
                disabled={streaming}
                className="w-full text-left text-xs text-cream/80 hover:text-cream border border-white/10 hover:border-electric/40 px-3 py-2 transition-colors duration-200 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {q}
              </button>
            ))}
          </div>
        )}

        {/* Input */}
        <form onSubmit={handleSubmit} className="border-t border-white/5 px-5 py-4">
          <div className="flex items-center gap-2">
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={streaming ? 'Generating…' : 'Ask anything…'}
              maxLength={800}
              disabled={streaming}
              aria-label="Ask the BLVSTACK agent"
              className="flex-1 bg-white/5 border border-white/10 focus:border-electric/50 text-cream text-sm px-3 py-2 outline-none disabled:opacity-40"
            />
            <button
              type="submit"
              disabled={streaming || !input.trim()}
              className="bg-electric hover:bg-royal text-cream font-mono text-[10px] tracking-widest uppercase px-4 py-2 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Send
            </button>
          </div>
          <p className="text-[9px] text-slate/60 font-mono tracking-wide pt-2">
            Live · powered by Claude · responses generated in real time.
          </p>
        </form>

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
