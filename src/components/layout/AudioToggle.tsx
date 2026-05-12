import { useEffect, useRef, useState } from 'react';

let ctx: AudioContext | null = null;
let enabled = false;

function getCtx() {
  if (!ctx) ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
  return ctx;
}

function tone(freq: number, duration: number, type: OscillatorType = 'sine', gain = 0.04) {
  if (!enabled) return;
  const c = getCtx();
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  osc.connect(g);
  g.connect(c.destination);
  const now = c.currentTime;
  g.gain.setValueAtTime(0, now);
  g.gain.linearRampToValueAtTime(gain, now + 0.005);
  g.gain.exponentialRampToValueAtTime(0.0001, now + duration);
  osc.start(now);
  osc.stop(now + duration);
}

function whoosh() {
  if (!enabled) return;
  const c = getCtx();
  const noise = c.createBufferSource();
  const buf = c.createBuffer(1, c.sampleRate * 0.4, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) {
    data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
  }
  noise.buffer = buf;
  const filter = c.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = 800;
  filter.Q.value = 1.5;
  const g = c.createGain();
  g.gain.value = 0.03;
  noise.connect(filter);
  filter.connect(g);
  g.connect(c.destination);
  noise.start();
}

function click() {
  tone(660, 0.05, 'square', 0.025);
}

export default function AudioToggle() {
  const [on, setOn] = useState(false);
  const observerRef = useRef<IntersectionObserver | null>(null);

  // Load preference
  useEffect(() => {
    const saved = localStorage.getItem('blv-audio') === 'on';
    setOn(saved);
    enabled = saved;
  }, []);

  // Wire global click sounds on buttons/links
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (!enabled) return;
      const el = e.target as HTMLElement;
      if (el.closest('button, a, [data-magnetic]')) click();
    };
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, []);

  // Wire whoosh on sections appearing
  useEffect(() => {
    if (observerRef.current) observerRef.current.disconnect();
    const sections = document.querySelectorAll('section');
    const obs = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting && e.intersectionRatio > 0.3) {
            whoosh();
            obs.unobserve(e.target);
          }
        });
      },
      { threshold: 0.3 }
    );
    sections.forEach((s) => obs.observe(s));
    observerRef.current = obs;
    return () => obs.disconnect();
  }, []);

  const toggle = () => {
    const next = !on;
    setOn(next);
    enabled = next;
    localStorage.setItem('blv-audio', next ? 'on' : 'off');
    if (next) {
      // Resume audio context on first user gesture
      getCtx().resume?.();
      click();
    }
  };

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={on ? 'Disable interaction sound' : 'Enable interaction sound'}
      aria-pressed={on}
      className="fixed bottom-6 left-6 z-50 w-10 h-10 flex items-center justify-center border border-white/10 bg-navy/80 backdrop-blur-sm text-slate hover:text-electric hover:border-electric/40 transition-colors duration-300"
    >
      {on ? (
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
          <path d="M1 5V9H4L7 11V3L4 5H1Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
          <path d="M9.5 4C10.5 5 10.5 9 9.5 10" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          <path d="M11.5 2C13 3.5 13 10.5 11.5 12" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        </svg>
      ) : (
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
          <path d="M1 5V9H4L7 11V3L4 5H1Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
          <path d="M10 5L13 8M13 5L10 8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        </svg>
      )}
    </button>
  );
}
