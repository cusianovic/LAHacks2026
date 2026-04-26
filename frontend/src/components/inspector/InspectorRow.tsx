import clsx from 'clsx';
import type { ReactNode } from 'react';

// =====================================================================
// InspectorRow — label + control pair, Figma right-bar style.
//
// Two layouts:
//   stacked (default)             inline
//   ┌──────────────┐              ┌──────────────────────────────┐
//   │ Label        │              │ Label              <control> │
//   │ <control>    │              └──────────────────────────────┘
//   └──────────────┘
//
// Labels are intentionally low-emphasis (`text-ink-dim`, 11px Light)
// — the control should carry the visual weight.
//
// `children` is the control(s). Pass two children for "side-by-side"
// inputs (e.g. `X 0  Y 0`) and they'll share the row width.
// =====================================================================

interface InspectorRowProps {
  label?: ReactNode;
  /** Render label + control on one line (label left, control right). */
  inline?: boolean;
  /** Optional helper text shown below the control. */
  hint?: ReactNode;
  children: ReactNode;
  className?: string;
}

export default function InspectorRow({
  label,
  inline,
  hint,
  children,
  className,
}: InspectorRowProps) {
  if (inline) {
    return (
      <div className={clsx('flex flex-col gap-0.5', className)}>
        <div className="flex items-center justify-between gap-2">
          {label ? (
            <span className="select-none text-[11px] font-light leading-none text-ink-dim">
              {label}
            </span>
          ) : null}
          <div className="flex min-w-0 flex-1 items-center justify-end gap-1">
            {children}
          </div>
        </div>
        {hint ? <RowHint>{hint}</RowHint> : null}
      </div>
    );
  }

  return (
    <div className={clsx('flex flex-col gap-1', className)}>
      {label ? (
        <span className="select-none text-[11px] font-light leading-none text-ink-dim">
          {label}
        </span>
      ) : null}
      <div className="flex items-center gap-1">{children}</div>
      {hint ? <RowHint>{hint}</RowHint> : null}
    </div>
  );
}

function RowHint({ children }: { children: ReactNode }) {
  return (
    <p className="px-0.5 text-[10px] font-light leading-tight text-ink-faint">
      {children}
    </p>
  );
}
