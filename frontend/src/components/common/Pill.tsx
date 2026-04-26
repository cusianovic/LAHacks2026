import clsx from 'clsx';
import type { ReactNode } from 'react';

// =====================================================================
// Pill — small monospace badge for tiers, mime types, edge labels, etc.
// =====================================================================

interface PillProps {
  children: ReactNode;
  tone?: 'neutral' | 'brand' | 'warn' | 'danger' | 'info';
  className?: string;
  mono?: boolean;
}

const TONES: Record<NonNullable<PillProps['tone']>, string> = {
  neutral: 'bg-raised text-ink-dim border-border',
  brand: 'bg-accent/15 text-accent-dim border-accent/30',
  warn: 'bg-amber-500/15 text-amber-200 border-amber-500/30',
  danger: 'bg-red-500/15 text-red-200 border-red-500/30',
  info: 'bg-cyan-500/15 text-cyan-200 border-cyan-500/30',
};

export default function Pill({ children, tone = 'neutral', mono = true, className }: PillProps) {
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1 rounded px-1.5 py-0.5 border text-[10px] leading-4',
        mono && 'font-mono',
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
