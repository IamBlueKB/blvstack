import { useEffect } from 'react';

export default function SmoothScroll() {
  useEffect(() => {
    // Respect reduced motion
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    let lenis: import('lenis').default | null = null;

    const init = async () => {
      const { default: Lenis } = await import('lenis');
      lenis = new Lenis({
        duration: 1.2,
        easing: (t: number) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
        smoothWheel: true,
      });

      const raf = (time: number) => {
        lenis?.raf(time);
        requestAnimationFrame(raf);
      };
      requestAnimationFrame(raf);

      // Expose for GSAP ScrollTrigger integration
      (window as unknown as Record<string, unknown>).__lenis = lenis;
    };

    init();

    return () => {
      lenis?.destroy();
    };
  }, []);

  return null;
}
