import { useEffect, useRef, useState } from 'react';

type RevenueRange = 'Under $250k' | '$250k–$1M' | '$1M–$5M' | '$5M+';
type Timeline = 'This month' | '1–3 months' | '3–6 months' | 'Just exploring';
type BudgetTier = '$5k–$15k' | '$15k–$50k' | '$50k+' | 'Not sure yet';

type FormState = {
  name: string;
  businessName: string;
  websiteUrl: string;
  revenueRange: RevenueRange | '';
  problem: string;
  timeline: Timeline | '';
  budgetTier: BudgetTier | '';
  email: string;
  phone: string;
  // honeypot — must stay empty
  hp: string;
  // service preselect from URL ?service=agents|systems|interfaces
  service: string;
};

const REVENUE: RevenueRange[] = ['Under $250k', '$250k–$1M', '$1M–$5M', '$5M+'];
const TIMELINES: Timeline[] = ['This month', '1–3 months', '3–6 months', 'Just exploring'];
const BUDGETS: BudgetTier[] = ['$5k–$15k', '$15k–$50k', '$50k+', 'Not sure yet'];

const TOTAL_STEPS = 7;

export default function StartForm() {
  const [step, setStep] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const focusRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  const mountedRef = useRef(false);

  // Focus the current step's input WITHOUT scrolling — and only after first user
  // interaction. This prevents autoFocus from scrolling past the hero on load.
  useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true;
      return; // skip initial mount focus entirely
    }
    focusRef.current?.focus({ preventScroll: true });
  }, [step]);
  const [form, setForm] = useState<FormState>({
    name: '',
    businessName: '',
    websiteUrl: '',
    revenueRange: '',
    problem: '',
    timeline: '',
    budgetTier: '',
    email: '',
    phone: '',
    hp: '',
    service: '',
  });

  // Read ?service= from URL on mount
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const svc = params.get('service');
    if (svc) setForm((f) => ({ ...f, service: svc }));
  }, []);

  const update = (patch: Partial<FormState>) => setForm((f) => ({ ...f, ...patch }));

  const canAdvance = (s: number): boolean => {
    switch (s) {
      case 1: return form.name.trim().length > 1;
      case 2: return form.businessName.trim().length > 0 && form.websiteUrl.trim().length > 0;
      case 3: return form.revenueRange !== '';
      case 4: return form.problem.trim().length > 10;
      case 5: return form.timeline !== '';
      case 6: return form.budgetTier !== '';
      case 7: return /^\S+@\S+\.\S+$/.test(form.email);
      default: return false;
    }
  };

  const next = () => {
    if (!canAdvance(step)) return;
    setError(null);
    if (step < TOTAL_STEPS) setStep((s) => s + 1);
    else submit();
  };

  const back = () => {
    setError(null);
    if (step > 1) setStep((s) => s - 1);
  };

  // Enter to advance (except on textarea)
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !(e.target as HTMLElement).matches('textarea')) {
      e.preventDefault();
      next();
    }
  };

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Submission failed (${res.status})`);
      }
      window.location.href = '/start/thank-you';
    } catch (err: any) {
      setError(err.message || 'Something went wrong. Please try again.');
      setSubmitting(false);
    }
  };

  const progress = ((step - 1) / TOTAL_STEPS) * 100;

  return (
    <div className="relative w-full max-w-2xl mx-auto" onKeyDown={handleKeyDown}>
      {/* Progress bar */}
      <div className="mb-12">
        <div className="flex items-center justify-between font-mono text-[10px] tracking-widest uppercase text-slate/60 mb-3">
          <span>Step <span className="text-cream">{String(step).padStart(2, '0')}</span> / {TOTAL_STEPS}</span>
          <span>{Math.round(progress)}% complete</span>
        </div>
        <div className="h-px bg-white/10 overflow-hidden">
          <div
            className="h-full bg-electric transition-all duration-500"
            style={{ width: `${((step) / TOTAL_STEPS) * 100}%` }}
          />
        </div>
      </div>

      {/* Step content */}
      <div className="min-h-[280px]">
        {step === 1 && (
          <StepShell label="Your name" hint="What should we call you?">
            <input
              type="text"
              ref={(el) => (focusRef.current = el)}
              value={form.name}
              onChange={(e) => update({ name: e.target.value })}
              placeholder="First & last name"
              className="apply-input"
            />
          </StepShell>
        )}

        {step === 2 && (
          <StepShell label="About your business" hint="The basics.">
            <div className="space-y-4">
              <input
                type="text"
                ref={(el) => (focusRef.current = el)}
                value={form.businessName}
                onChange={(e) => update({ businessName: e.target.value })}
                placeholder="Business name"
                className="apply-input"
              />
              <input
                type="url"
                value={form.websiteUrl}
                onChange={(e) => update({ websiteUrl: e.target.value })}
                placeholder="Website URL (https://...)"
                className="apply-input"
              />
            </div>
          </StepShell>
        )}

        {step === 3 && (
          <StepShell label="Annual revenue range" hint="Helps us scope correctly. No specifics needed.">
            <RadioGroup
              options={REVENUE}
              value={form.revenueRange}
              onChange={(v) => update({ revenueRange: v as RevenueRange })}
            />
          </StepShell>
        )}

        {step === 4 && (
          <StepShell label="What are you trying to solve?" hint="The more detail, the better the scope.">
            <textarea
              ref={(el) => (focusRef.current = el)}
              value={form.problem}
              onChange={(e) => update({ problem: e.target.value })}
              placeholder="The problem in your own words..."
              rows={6}
              className="apply-input resize-none"
            />
          </StepShell>
        )}

        {step === 5 && (
          <StepShell label="Timeline" hint="When does this need to be running?">
            <RadioGroup
              options={TIMELINES}
              value={form.timeline}
              onChange={(v) => update({ timeline: v as Timeline })}
            />
          </StepShell>
        )}

        {step === 6 && (
          <StepShell label="Budget tier" hint="No commitments — just helps us pre-scope.">
            <RadioGroup
              options={BUDGETS}
              value={form.budgetTier}
              onChange={(v) => update({ budgetTier: v as BudgetTier })}
            />
          </StepShell>
        )}

        {step === 7 && (
          <StepShell label="How do we reach you?" hint="We respond within 24 hours.">
            <div className="space-y-4">
              <input
                type="email"
                ref={(el) => (focusRef.current = el)}
                value={form.email}
                onChange={(e) => update({ email: e.target.value })}
                placeholder="Email"
                className="apply-input"
              />
              <input
                type="tel"
                value={form.phone}
                onChange={(e) => update({ phone: e.target.value })}
                placeholder="Phone (optional)"
                className="apply-input"
              />
              {/* Honeypot — should never be filled */}
              <input
                type="text"
                value={form.hp}
                onChange={(e) => update({ hp: e.target.value })}
                tabIndex={-1}
                autoComplete="off"
                aria-hidden="true"
                style={{ position: 'absolute', left: '-9999px', width: '1px', height: '1px' }}
              />
            </div>
          </StepShell>
        )}
      </div>

      {error && (
        <p className="mt-6 font-mono text-xs text-red-400/90">{error}</p>
      )}

      {/* Footer controls */}
      <div className="mt-12 flex items-center justify-between gap-4">
        <button
          type="button"
          onClick={back}
          disabled={step === 1 || submitting}
          className="font-mono text-xs tracking-widest uppercase text-slate hover:text-electric disabled:text-slate/30 disabled:cursor-not-allowed transition-colors duration-300 inline-flex items-center gap-2"
        >
          <svg width="14" height="10" viewBox="0 0 14 10" fill="none" aria-hidden="true">
            <path d="M13 5H1M1 5L5 9M1 5L5 1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="square" />
          </svg>
          Back
        </button>

        <button
          type="button"
          onClick={next}
          disabled={!canAdvance(step) || submitting}
          className="apply-cta group"
        >
          <span className="apply-cta-inner">
            <span>
              {submitting ? 'Submitting...' : step === TOTAL_STEPS ? 'Submit application' : 'Continue'}
            </span>
            {!submitting && (
              <svg width="14" height="10" viewBox="0 0 14 10" fill="none" aria-hidden="true" className="apply-cta-arrow">
                <path d="M1 5H13M13 5L9 1M13 5L9 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="square" />
              </svg>
            )}
          </span>
        </button>
      </div>

      {form.service && (
        <p className="mt-8 font-mono text-[10px] tracking-widest uppercase text-slate/50">
          Service preselect: <span className="text-electric">{form.service}</span>
        </p>
      )}

      <style>{`
        .apply-input {
          width: 100%;
          background: transparent;
          border: 0;
          border-bottom: 1px solid rgba(255, 255, 255, 0.15);
          padding: 0.75rem 0;
          font-family: var(--font-mono, ui-monospace, monospace);
          font-size: 1rem;
          color: #FAF8F3;
          outline: none;
          transition: border-color 0.3s ease, padding 0.3s ease;
        }
        .apply-input:focus {
          border-bottom-color: #2563EB;
        }
        .apply-input::placeholder {
          color: rgba(148, 163, 184, 0.5);
        }
        textarea.apply-input {
          font-size: 0.95rem;
          line-height: 1.6;
          border-bottom: none;
          border: 1px solid rgba(255, 255, 255, 0.10);
          padding: 0.875rem 1rem;
        }
        textarea.apply-input:focus {
          border-color: rgba(37, 99, 235, 0.5);
        }

        .apply-cta {
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
        .apply-cta:disabled {
          cursor: not-allowed;
          opacity: 0.5;
          box-shadow: none;
        }
        .apply-cta-inner {
          display: inline-flex;
          align-items: center;
          gap: 0.625rem;
          padding: 0.875rem 1.5rem;
          color: #FAF8F3;
          font-family: var(--font-mono, ui-monospace, monospace);
          font-size: 0.75rem;
          font-weight: 500;
          letter-spacing: 0.2em;
          text-transform: uppercase;
        }
        .apply-cta-arrow {
          transition: transform 0.3s cubic-bezier(0.16, 1, 0.3, 1);
        }
        .apply-cta:not(:disabled):hover {
          transform: translateY(-1px);
          box-shadow:
            0 0 0 1px rgba(37, 99, 235, 0.3),
            inset 0 1px 0 rgba(255, 255, 255, 0.28),
            inset 0 -1px 0 rgba(0, 0, 0, 0.3),
            0 0 36px rgba(37, 99, 235, 0.7),
            0 0 100px rgba(37, 99, 235, 0.4);
        }
        .apply-cta:not(:disabled):hover .apply-cta-arrow {
          transform: translateX(3px);
        }
      `}</style>
    </div>
  );
}

// ---------- Step shell ----------
function StepShell({
  label,
  hint,
  children,
}: {
  label: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-8 animate-step-in">
      <div>
        <h2 className="text-3xl md:text-4xl font-bold tracking-tight text-cream leading-tight">
          {label}
        </h2>
        <p className="mt-3 text-sm font-mono tracking-widest uppercase text-slate/60">
          {hint}
        </p>
      </div>
      <div>{children}</div>
      <style>{`
        @keyframes step-in {
          from { opacity: 0; transform: translateY(10px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .animate-step-in {
          animation: step-in 0.4s cubic-bezier(0.16, 1, 0.3, 1) forwards;
        }
      `}</style>
    </div>
  );
}

// ---------- Radio group ----------
function RadioGroup({
  options,
  value,
  onChange,
}: {
  options: string[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      {options.map((opt) => {
        const selected = value === opt;
        return (
          <button
            key={opt}
            type="button"
            onClick={() => onChange(opt)}
            className={`relative text-left p-4 border transition-all duration-300 font-mono text-sm ${
              selected
                ? 'border-electric bg-electric/[0.08] text-cream'
                : 'border-white/10 text-cream/70 hover:border-electric/40 hover:text-cream'
            }`}
          >
            <span className="flex items-center gap-3">
              <span
                className={`block w-2.5 h-2.5 rounded-full border transition-colors duration-300 shrink-0 ${
                  selected ? 'bg-electric border-electric' : 'border-white/30'
                }`}
              />
              <span>{opt}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
