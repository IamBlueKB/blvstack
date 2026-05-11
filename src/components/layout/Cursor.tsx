import { useEffect, useRef } from 'react';

export default function Cursor() {
  const dotRef = useRef<HTMLDivElement>(null);
  const pos = useRef({ x: -100, y: -100 });
  const current = useRef({ x: -100, y: -100 });
  const rafRef = useRef<number>(0);
  const isHovering = useRef(false);

  useEffect(() => {
    // Don't run on touch devices
    if (window.matchMedia('(hover: none)').matches) return;

    const dot = dotRef.current;
    if (!dot) return;

    const onMove = (e: MouseEvent) => {
      pos.current = { x: e.clientX, y: e.clientY };
    };

    const onEnterInteractive = () => { isHovering.current = true; };
    const onLeaveInteractive = () => { isHovering.current = false; };

    const interactiveSelector =
      'a, button, input, textarea, select, [role="button"], label';

    const attachListeners = () => {
      document.querySelectorAll<HTMLElement>(interactiveSelector).forEach((el) => {
        el.addEventListener('mouseenter', onEnterInteractive);
        el.addEventListener('mouseleave', onLeaveInteractive);
      });
    };

    attachListeners();

    // Re-attach on Astro page transitions
    document.addEventListener('astro:page-load', attachListeners);

    window.addEventListener('mousemove', onMove);

    // Magnetic pull on buttons
    const onButtonMouseMove = (e: MouseEvent) => {
      const btn = (e.currentTarget as HTMLElement);
      const rect = btn.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const dx = e.clientX - cx;
      const dy = e.clientY - cy;
      btn.style.transform = `translate(${dx * 0.25}px, ${dy * 0.25}px)`;
    };
    const onButtonMouseLeave = (e: MouseEvent) => {
      (e.currentTarget as HTMLElement).style.transform = '';
    };

    const attachMagnetic = () => {
      document.querySelectorAll<HTMLElement>('[data-magnetic]').forEach((btn) => {
        btn.addEventListener('mousemove', onButtonMouseMove);
        btn.addEventListener('mouseleave', onButtonMouseLeave);
      });
    };
    attachMagnetic();
    document.addEventListener('astro:page-load', attachMagnetic);

    // Lerp loop
    const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

    const tick = () => {
      current.current.x = lerp(current.current.x, pos.current.x, 0.18);
      current.current.y = lerp(current.current.y, pos.current.y, 0.18);

      if (dot) {
        const scale = isHovering.current ? 3 : 1;
        const mix = isHovering.current ? 'difference' : 'normal';
        dot.style.transform = `translate(${current.current.x - 6}px, ${current.current.y - 6}px) scale(${scale})`;
        dot.style.mixBlendMode = mix;
      }

      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);

    return () => {
      window.removeEventListener('mousemove', onMove);
      document.removeEventListener('astro:page-load', attachListeners);
      document.removeEventListener('astro:page-load', attachMagnetic);
      cancelAnimationFrame(rafRef.current);
    };
  }, []);

  return (
    <div
      ref={dotRef}
      aria-hidden="true"
      className="pointer-events-none fixed top-0 left-0 z-[9999] h-3 w-3 rounded-full bg-cream will-change-transform"
      style={{
        transform: 'translate(-100px, -100px)',
        transition: 'transform 0s, mix-blend-mode 0.2s',
      }}
    />
  );
}
