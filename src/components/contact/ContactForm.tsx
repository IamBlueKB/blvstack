import { useState, useRef, useEffect } from 'react';

type FormState = {
  name: string;
  email: string;
  message: string;
  hp: string; // honeypot
};

export default function ContactForm() {
  const [form, setForm] = useState<FormState>({ name: '', email: '', message: '', hp: '' });
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  // Don't autoFocus on mount (would scroll past the hero)
  useEffect(() => {
    // Component mounted; we leave focus to the user
  }, []);

  const update = (patch: Partial<FormState>) => setForm((f) => ({ ...f, ...patch }));

  const valid =
    form.name.trim().length > 1 &&
    /^\S+@\S+\.\S+$/.test(form.email) &&
    form.message.trim().length > 10;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Submission failed (${res.status})`);
      }
      setSuccess(true);
      setForm({ name: '', email: '', message: '', hp: '' });
    } catch (err: any) {
      setError(err.message || 'Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  if (success) {
    return (
      <div className="border-t border-white/5 pt-12">
        <div className="flex items-center gap-3 mb-6">
          <span className="relative flex w-2 h-2">
            <span className="absolute inset-0 rounded-full bg-electric animate-ping opacity-75" />
            <span className="relative w-2 h-2 rounded-full bg-electric" />
          </span>
          <span className="font-mono text-[11px] tracking-[0.25em] uppercase text-electric">
            // Message Received
          </span>
        </div>
        <h2 className="text-3xl md:text-4xl font-bold text-cream tracking-tight leading-tight max-w-xl">
          Got it. Talk soon.
        </h2>
        <p className="mt-4 text-base text-slate leading-relaxed max-w-md">
          We respond to every message within 24 hours. Check your inbox — including spam — for a reply from{' '}
          <span className="text-cream">hello@blvstack.com</span>.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="border-t border-white/5 pt-12 max-w-2xl">
      <div className="flex flex-col gap-8">
        <div>
          <label htmlFor="contact-name" className="block font-mono text-[10px] tracking-widest uppercase text-slate/60 mb-2">
            Name
          </label>
          <input
            id="contact-name"
            ref={nameRef}
            type="text"
            value={form.name}
            onChange={(e) => update({ name: e.target.value })}
            placeholder="First & last name"
            className="contact-input"
            required
          />
        </div>

        <div>
          <label htmlFor="contact-email" className="block font-mono text-[10px] tracking-widest uppercase text-slate/60 mb-2">
            Email
          </label>
          <input
            id="contact-email"
            type="email"
            value={form.email}
            onChange={(e) => update({ email: e.target.value })}
            placeholder="you@company.com"
            className="contact-input"
            required
          />
        </div>

        <div>
          <label htmlFor="contact-message" className="block font-mono text-[10px] tracking-widest uppercase text-slate/60 mb-2">
            Message
          </label>
          <textarea
            id="contact-message"
            value={form.message}
            onChange={(e) => update({ message: e.target.value })}
            placeholder="What's the question?"
            rows={6}
            className="contact-input resize-none"
            required
          />
        </div>

        {/* Honeypot */}
        <input
          type="text"
          value={form.hp}
          onChange={(e) => update({ hp: e.target.value })}
          tabIndex={-1}
          autoComplete="off"
          aria-hidden="true"
          style={{ position: 'absolute', left: '-9999px', width: '1px', height: '1px' }}
        />

        {error && (
          <p className="font-mono text-xs text-red-400/90">{error}</p>
        )}

        <div className="pt-2">
          <button
            type="submit"
            disabled={!valid || submitting}
            className="contact-cta group"
          >
            <span className="contact-cta-inner">
              <span>{submitting ? 'Sending...' : 'Send message'}</span>
              {!submitting && (
                <svg width="14" height="10" viewBox="0 0 14 10" fill="none" aria-hidden="true" className="contact-cta-arrow">
                  <path d="M1 5H13M13 5L9 1M13 5L9 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="square" />
                </svg>
              )}
            </span>
          </button>
        </div>
      </div>

      <style>{`
        .contact-input {
          width: 100%;
          background: transparent;
          border: 0;
          border-bottom: 1px solid rgba(255, 255, 255, 0.15);
          padding: 0.75rem 0;
          font-family: var(--font-mono, ui-monospace, monospace);
          font-size: 1rem;
          color: #FAF8F3;
          outline: none;
          transition: border-color 0.3s ease;
        }
        .contact-input:focus {
          border-bottom-color: #2563EB;
        }
        .contact-input::placeholder {
          color: rgba(148, 163, 184, 0.5);
        }
        textarea.contact-input {
          font-size: 0.95rem;
          line-height: 1.6;
          border-bottom: none;
          border: 1px solid rgba(255, 255, 255, 0.10);
          padding: 0.875rem 1rem;
        }
        textarea.contact-input:focus {
          border-color: rgba(37, 99, 235, 0.5);
        }

        .contact-cta {
          position: relative;
          display: inline-flex;
          isolation: isolate;
          border: 1px solid rgba(37, 99, 235, 0.6);
          background: linear-gradient(180deg, #2D72FF 0%, #2563EB 45%, #1E40AF 100%);
          box-shadow:
            0 0 0 1px rgba(37, 99, 235, 0.2),
            inset 0 1px 0 rgba(255, 255, 255, 0.20),
            inset 0 -1px 0 rgba(0, 0, 0, 0.25),
            0 0 24px rgba(37, 99, 235, 0.45),
            0 0 60px rgba(37, 99, 235, 0.25);
          transition: transform 0.3s cubic-bezier(0.16, 1, 0.3, 1),
                      box-shadow 0.3s cubic-bezier(0.16, 1, 0.3, 1);
          cursor: pointer;
        }
        .contact-cta:disabled {
          cursor: not-allowed;
          opacity: 0.5;
          box-shadow: none;
        }
        .contact-cta-inner {
          display: inline-flex;
          align-items: center;
          gap: 0.625rem;
          padding: 0.875rem 1.75rem;
          color: #FAF8F3;
          font-family: var(--font-mono, ui-monospace, monospace);
          font-size: 0.75rem;
          font-weight: 500;
          letter-spacing: 0.2em;
          text-transform: uppercase;
        }
        .contact-cta-arrow {
          transition: transform 0.3s cubic-bezier(0.16, 1, 0.3, 1);
        }
        .contact-cta:not(:disabled):hover {
          transform: translateY(-1px);
          box-shadow:
            0 0 0 1px rgba(37, 99, 235, 0.3),
            inset 0 1px 0 rgba(255, 255, 255, 0.28),
            inset 0 -1px 0 rgba(0, 0, 0, 0.3),
            0 0 36px rgba(37, 99, 235, 0.7),
            0 0 100px rgba(37, 99, 235, 0.4);
        }
        .contact-cta:not(:disabled):hover .contact-cta-arrow {
          transform: translateX(3px);
        }
      `}</style>
    </form>
  );
}
