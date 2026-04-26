import type { ReactNode } from 'react';
import clsx from 'clsx';

// =====================================================================
// Field — labeled control wrapper used in the right panel.
// =====================================================================

interface FieldProps {
  label: ReactNode;
  hint?: ReactNode;
  required?: boolean;
  className?: string;
  children: ReactNode;
}

export default function Field({ label, hint, required, className, children }: FieldProps) {
  return (
    <label className={clsx('flex flex-col gap-1', className)}>
      <span className="flex items-center gap-1 text-2xs font-medium uppercase tracking-[0.1em] text-ink-dim">
        {label}
        {required ? <span className="text-accent">*</span> : null}
      </span>
      {children}
      {hint ? <span className="text-2xs text-ink-faint">{hint}</span> : null}
    </label>
  );
}
