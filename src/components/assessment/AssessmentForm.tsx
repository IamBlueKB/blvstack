import { useEffect, useRef, useState } from 'react';
import { StepShell, RadioGroup, APPLY_STYLES } from '../start/StartForm';
import { NEEDS, GOALS, TIMELINES, MAX_GOALS, type NeedKey, type GoalKey, type TimelineKey, type Brief } from '../../lib/assessment-options';

const TOTAL_STEPS = 6;
const SITE_KEY: string = import.meta.env.PUBLIC_TURNSTILE_SITE_KEY ?? '';

type Form = {
  need: NeedKey | '';
  currentSite: string;
  noSite: boolean;
  goals: GoalKey[];
  about: string;
  timeline: TimelineKey | '';
  name: string;
  email: string;
  phone: string;
  hp: string; // honeypot — must stay empty
};

const byLabel = <K extends string>(map: Record<K, string>, label: string) =>
  (Object.keys(map) as K[]).find((k) => map[k] === label);

declare global {
  interface Window {
    turnstile?: { render: (el: HTMLElement, opts: Record<string, unknown>) => string; reset: (id?: string) => void };
  }
}

export default function AssessmentForm() {
  const [step, setStep] = useState(1);
  const [form, setForm] = useState<Form>({ need: '', currentSite: '', noSite: false, goals: [], about: '', timeline: '', name: '', email: '', phone: '', hp: '' });
  const [token, setToken] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [brief, setBrief] = useState<Brief | null>(null);
  const [sentTo, setSentTo] = useState('');
  const focusRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  const mounted = useRef(false);
  const widgetRef = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);

  const update = (patch: Partial<Form>) => setForm((f) => ({ ...f, ...patch }));

  // Focus the step's input without scrolling — only after the first interaction.
  useEffect(() => {
    if (!mounted.current) { mounted.current = true; return; }
    focusRef.current?.focus({ preventScroll: true });
  }, [step]);

  // Turnstile on the last step (explicit render, so it survives step changes).
  useEffect(() => {
    if (step !== TOTAL_STEPS || !SITE_KEY || !widgetRef.current || widgetId.current) return;
    const mount = () => {
      if (!window.turnstile || !widgetRef.current || widgetId.current) return;
      widgetId.current = window.turnstile.render(widgetRef.current, {
        sitekey: SITE_KEY,
        theme: 'dark',
        callback: (t: string) => setToken(t),
        'expired-callback': () => setToken(''),
        'error-callback': () => setToken(''),
      });
    };
    if (window.turnstile) mount();
    else {
      const s = document.createElement('script');
      s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      s.async = true;
      s.onload = mount;
      document.head.appendChild(s);
    }
  }, [step]);

  const canAdvance = (s: number): boolean => {
    switch (s) {
      case 1: return form.need !== '';
      case 2: return form.noSite || form.currentSite.trim().length > 3;
      case 3: return form.goals.length > 0;
      case 4: return form.about.trim().length >= 10;
      case 5: return form.timeline !== '';
      case 6: return form.name.trim().length > 1 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email) && (!SITE_KEY || !!token);
      default: return false;
    }
  };

  const next = () => {
    if (!canAdvance(step) || submitting) return;
    setError(null);
    if (step < TOTAL_STEPS) setStep((s) => s + 1);
    else submit();
  };
  const back = () => { setError(null); if (step > 1) setStep((s) => s - 1); };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !(e.target as HTMLElement).matches('textarea')) { e.preventDefault(); next(); }
  };

  const toggleGoal = (g: GoalKey) =>
    setForm((f) => {
      if (f.goals.includes(g)) return { ...f, goals: f.goals.filter((x) => x !== g) };
      if (f.goals.length >= MAX_GOALS) return f;
      return { ...f, goals: [...f.goals, g] };
    });

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/assessment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          need: form.need,
          current_site: form.noSite ? null : form.currentSite,
          goals: form.goals,
          about: form.about,
          timeline: form.timeline,
          name: form.name,
          email: form.email,
          phone: form.phone,
          hp: form.hp,
          turnstile_token: token,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Submission failed (${res.status})`);
      setSentTo(form.email);
      setBrief(data.brief ?? null);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err: any) {
      setError(err.message || 'Something went wrong. Please try again.');
      setToken('');
      if (widgetId.current) window.turnstile?.reset(widgetId.current);
    } finally {
      setSubmitting(false);
    }
  };

  if (brief) return <BriefView brief={brief} sentTo={sentTo} />;

  const progress = ((step - 1) / TOTAL_STEPS) * 100;

  return (
    <div className="relative w-full max-w-2xl mx-auto" onKeyDown={onKeyDown}>
      <div className="mb-12">
        <div className="flex items-center justify-between font-mono text-[10px] tracking-widest uppercase text-slate/60 mb-3">
          <span>Step <span className="text-cream">{String(step).padStart(2, '0')}</span> / {TOTAL_STEPS}</span>
          <span>{Math.round(progress)}% complete</span>
        </div>
        <div className="h-px bg-white/10 overflow-hidden">
          <div className="h-full bg-electric transition-all duration-500" style={{ width: `${(step / TOTAL_STEPS) * 100}%` }} />
        </div>
      </div>

      <div className="min-h-[280px]">
        {step === 1 && (
          <StepShell label="What do you need?" hint="Pick the closest.">
            <RadioGroup options={Object.values(NEEDS)} value={form.need ? NEEDS[form.need] : ''} onChange={(v) => update({ need: byLabel(NEEDS, v) ?? '' })} />
          </StepShell>
        )}

        {step === 2 && (
          <StepShell label="Your current site" hint="If you have one.">
            <div className="space-y-5">
              <input
                type="url"
                ref={(el) => { focusRef.current = el; }}
                value={form.currentSite}
                disabled={form.noSite}
                onChange={(e) => update({ currentSite: e.target.value })}
                placeholder="yoursite.com"
                className="apply-input disabled:opacity-40"
              />
              <button
                type="button"
                onClick={() => update({ noSite: !form.noSite })}
                aria-pressed={form.noSite}
                className={`inline-flex items-center gap-3 font-mono text-sm transition-colors ${form.noSite ? 'text-cream' : 'text-cream/60 hover:text-cream'}`}
              >
                <span className={`block w-3.5 h-3.5 border transition-colors ${form.noSite ? 'bg-electric border-electric' : 'border-white/30'}`} />
                I don&rsquo;t have a site yet
              </button>
            </div>
          </StepShell>
        )}

        {step === 3 && (
          <StepShell label="What should the site do for you?" hint={`Pick up to ${MAX_GOALS}.`}>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {(Object.keys(GOALS) as GoalKey[]).map((g) => {
                const on = form.goals.includes(g);
                const full = !on && form.goals.length >= MAX_GOALS;
                return (
                  <button
                    key={g}
                    type="button"
                    onClick={() => toggleGoal(g)}
                    aria-pressed={on}
                    disabled={full}
                    className={`relative text-left p-4 border transition-all duration-300 font-mono text-sm disabled:opacity-35 disabled:cursor-not-allowed ${
                      on ? 'border-electric bg-electric/[0.08] text-cream' : 'border-white/10 text-cream/70 hover:border-electric/40 hover:text-cream'
                    }`}
                  >
                    <span className="flex items-center gap-3">
                      <span className={`block w-2.5 h-2.5 border transition-colors duration-300 shrink-0 ${on ? 'bg-electric border-electric' : 'border-white/30'}`} />
                      <span>{GOALS[g]}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </StepShell>
        )}

        {step === 4 && (
          <StepShell label="Tell us about the business or project" hint="A line or two is plenty.">
            <textarea
              ref={(el) => { focusRef.current = el; }}
              value={form.about}
              onChange={(e) => update({ about: e.target.value })}
              placeholder="Who it's for, what you do, anything we should know…"
              rows={5}
              maxLength={1200}
              className="apply-input resize-none"
            />
          </StepShell>
        )}

        {step === 5 && (
          <StepShell label="When do you want it live?" hint="A rough answer is fine.">
            <RadioGroup options={Object.values(TIMELINES)} value={form.timeline ? TIMELINES[form.timeline] : ''} onChange={(v) => update({ timeline: byLabel(TIMELINES, v) ?? '' })} />
          </StepShell>
        )}

        {step === 6 && (
          <StepShell label="Where should we send your brief?" hint="It shows up here and in your inbox.">
            <div className="space-y-4">
              <input
                type="text"
                ref={(el) => { focusRef.current = el; }}
                value={form.name}
                onChange={(e) => update({ name: e.target.value })}
                placeholder="Your name"
                className="apply-input"
              />
              <input type="email" value={form.email} onChange={(e) => update({ email: e.target.value })} placeholder="Email" className="apply-input" />
              <input type="tel" value={form.phone} onChange={(e) => update({ phone: e.target.value })} placeholder="Phone (optional)" className="apply-input" />
              <input
                type="text"
                value={form.hp}
                onChange={(e) => update({ hp: e.target.value })}
                tabIndex={-1}
                autoComplete="off"
                aria-hidden="true"
                style={{ position: 'absolute', left: '-9999px', width: '1px', height: '1px' }}
              />
              {SITE_KEY && <div ref={widgetRef} className="pt-4 min-h-[65px]" />}
            </div>
          </StepShell>
        )}
      </div>

      {error && <p className="mt-6 font-mono text-xs text-red-400/90" role="alert">{error}</p>}

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
        <button type="button" onClick={next} disabled={!canAdvance(step) || submitting} className="apply-cta group">
          <span className="apply-cta-inner">
            <span>{submitting ? 'Writing your brief…' : step === TOTAL_STEPS ? 'Get my brief' : 'Continue'}</span>
            {!submitting && (
              <svg width="14" height="10" viewBox="0 0 14 10" fill="none" aria-hidden="true" className="apply-cta-arrow">
                <path d="M1 5H13M13 5L9 1M13 5L9 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="square" />
              </svg>
            )}
          </span>
        </button>
      </div>

      <style>{APPLY_STYLES}</style>
    </div>
  );
}

/** The brief, rendered in place of the form. */
function BriefView({ brief, sentTo }: { brief: Brief; sentTo: string }) {
  const Section = ({ label, children }: { label: string; children: React.ReactNode }) => (
    <div className="py-8 border-t border-white/5">
      <p className="font-mono text-[11px] tracking-[0.25em] uppercase text-slate/70 mb-3">{label}</p>
      <div className="text-lg md:text-xl text-cream/90 leading-relaxed max-w-2xl">{children}</div>
    </div>
  );
  return (
    <div className="w-full max-w-2xl mx-auto animate-step-in">
      <div className="flex items-center gap-4 mb-8">
        <span className="h-px w-10 bg-electric" />
        <span className="font-mono text-[11px] tracking-[0.25em] uppercase text-electric">// Your project brief</span>
      </div>
      <h2 className="text-4xl md:text-5xl font-bold tracking-tight text-cream leading-[0.95] mb-10">
        {brief.name}, <span className="text-electric">here&rsquo;s your brief.</span>
      </h2>
      <Section label="What you're after">{brief.goals}</Section>
      <Section label="Recommended approach">
        <strong className="text-cream">{brief.approach.title}.</strong> {brief.approach.why}
      </Section>
      <Section label="Rough timeline">{brief.timeline}</Section>
      <Section label="Next step">
        <p>{brief.next_step.text}</p>
        <a href={brief.next_step.url} className="apply-cta group mt-8 inline-flex">
          <span className="apply-cta-inner">
            <span>Book a call</span>
            <svg width="14" height="10" viewBox="0 0 14 10" fill="none" aria-hidden="true" className="apply-cta-arrow">
              <path d="M1 5H13M13 5L9 1M13 5L9 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="square" />
            </svg>
          </span>
        </a>
      </Section>
      {sentTo && (
        <p className="pt-6 border-t border-white/5 font-mono text-[11px] tracking-widest uppercase text-slate/60">
          A copy is on its way to <span className="text-cream/80 normal-case tracking-normal">{sentTo}</span>
        </p>
      )}
      <style>{APPLY_STYLES}{`
        @keyframes step-in { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
        .animate-step-in { animation: step-in 0.4s cubic-bezier(0.16, 1, 0.3, 1) forwards; }
      `}</style>
    </div>
  );
}
