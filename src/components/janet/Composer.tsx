/** Shared input for both presentations. Enter sends, Shift+Enter newlines. */
import { forwardRef } from 'react';

const Composer = forwardRef<
  HTMLTextAreaElement,
  {
    value: string;
    onChange: (v: string) => void;
    onSend: () => void;
    busy: boolean;
    variant?: 'docked' | 'floating';
  }
>(function Composer({ value, onChange, onSend, busy, variant = 'docked' }, ref) {
  return (
    <div
      className={
        variant === 'floating'
          ? 'w-full max-w-2xl rounded-xl bg-navy/80 backdrop-blur-xl border border-white/10 shadow-2xl shadow-black/50 p-3'
          : ''
      }
    >
      <textarea
        ref={ref}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            onSend();
          }
        }}
        rows={variant === 'floating' ? 1 : 2}
        placeholder="Message JANET…"
        className="w-full resize-none bg-white/[0.04] border border-white/10 rounded-lg px-3 py-2 text-cream text-sm placeholder:text-slate/40 focus:outline-none focus:border-electric/50"
      />
      <div className="flex items-center justify-between mt-2">
        <span className="font-mono text-[9px] tracking-widest uppercase text-slate/40">
          Enter to send
        </span>
        <button
          onClick={onSend}
          disabled={busy || !value.trim()}
          className="font-mono text-[10px] tracking-widest uppercase px-3 py-1.5 rounded bg-electric text-navy disabled:opacity-30 disabled:cursor-not-allowed hover:opacity-90 transition-opacity"
        >
          {busy ? 'Working' : 'Send'}
        </button>
      </div>
    </div>
  );
});

export default Composer;
