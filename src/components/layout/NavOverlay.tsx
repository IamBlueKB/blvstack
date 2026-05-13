import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';

const links = [
  { label: 'Work', href: '/work' },
  { label: 'Services', href: '/services' },
  { label: 'About', href: '/about' },
  { label: 'Start', href: '/start' },
  { label: 'Contact', href: '/contact' },
];

export default function NavOverlay() {
  const [open, setOpen] = useState(false);

  // Close on route change
  useEffect(() => {
    const close = () => setOpen(false);
    document.addEventListener('astro:page-load', close);
    return () => document.removeEventListener('astro:page-load', close);
  }, []);

  // Lock body scroll when open
  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [open]);

  // Close on Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <>
      {/* Menu toggle button — fixed top-right */}
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label={open ? 'Close menu' : 'Open menu'}
        aria-expanded={open}
        aria-controls="nav-overlay"
        className="fixed top-6 right-6 z-[60] flex flex-col gap-[5px] p-2 group"
      >
        <span
          className="block h-px w-6 bg-cream transition-all duration-300 origin-center"
          style={{
            transform: open ? 'translateY(6px) rotate(45deg)' : 'none',
          }}
        />
        <span
          className="block h-px w-6 bg-cream transition-all duration-300"
          style={{ opacity: open ? 0 : 1, transform: open ? 'scaleX(0)' : 'none' }}
        />
        <span
          className="block h-px w-6 bg-cream transition-all duration-300 origin-center"
          style={{
            transform: open ? 'translateY(-6px) rotate(-45deg)' : 'none',
          }}
        />
      </button>

      {/* Full-screen overlay */}
      <AnimatePresence>
        {open && (
          <motion.div
            id="nav-overlay"
            role="dialog"
            aria-modal="true"
            aria-label="Navigation menu"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
            className="fixed inset-0 z-50 flex flex-col bg-navy-mid p-10 md:p-16"
          >
            {/* Subtle grid texture */}
            <div
              className="pointer-events-none absolute inset-0"
              style={{
                backgroundImage:
                  'linear-gradient(rgba(250,248,243,0.02) 1px, transparent 1px), linear-gradient(90deg, rgba(250,248,243,0.02) 1px, transparent 1px)',
                backgroundSize: '80px 80px',
              }}
            />

            {/* Nav links — vertically centered, sized to always fit viewport */}
            <nav className="relative flex-1 flex flex-col justify-center gap-3 md:gap-4 max-w-6xl">
              {links.map((link, i) => (
                <motion.a
                  key={link.href}
                  href={link.href}
                  initial={{ opacity: 0, y: 40 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 20 }}
                  transition={{
                    duration: 0.5,
                    delay: 0.05 * i,
                    ease: [0.16, 1, 0.3, 1],
                  }}
                  onClick={() => setOpen(false)}
                  className="group relative inline-flex items-baseline gap-4 md:gap-6 w-fit"
                  style={{ fontFamily: 'var(--font-sans)' }}
                >
                  <span className="font-mono text-[11px] tracking-widest uppercase text-slate/50 group-hover:text-electric transition-colors duration-300 pt-2 md:pt-4">
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  <span
                    className="font-bold tracking-tight text-cream transition-all duration-300 group-hover:text-electric group-hover:skew-x-[-2deg]"
                    style={{
                      fontSize: 'clamp(2.5rem, 9vw, 5.5rem)',
                      lineHeight: 0.95,
                    }}
                  >
                    {link.label}
                  </span>
                </motion.a>
              ))}
            </nav>

            {/* Bottom tagline */}
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.4, delay: 0.35 }}
              className="relative text-slate text-sm font-mono tracking-widest uppercase mt-8"
            >
              Systems that work while you don't.
            </motion.p>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
