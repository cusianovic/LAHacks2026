import clsx from 'clsx';
import type { ReactNode } from 'react';

// =====================================================================
// InspectorSection — Figma-style section block.
//
//   ┌──────────────────────────────────────┐
//   │ Title                  [icon ⊞ +  ─]│   ← 11px Geist Medium white
//   │ ────────────────────────────────────  │
//   │ <body>                                │
//   └──────────────────────────────────────┘
//
// Sections always have:
//   - 8px horizontal padding
//   - 8px vertical padding
//   - 1px bottom border in `--color-border`
//
// Pass `actions` for the right-side icon row (the +, eye, grid, etc.
// you see in Figma's Position / Auto layout / Fill sections).
// Pass `bare` to opt out of the bottom border (last section in a panel).
// =====================================================================

interface InspectorSectionProps {
  title?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  /** Drop the bottom hairline (use for the last section). */
  bare?: boolean;
}

export default function InspectorSection({
  title,
  actions,
  children,
  className,
  bare,
}: InspectorSectionProps) {
  return (
    <section
      className={clsx(
        'flex flex-col gap-2 px-2 py-2',
        !bare && 'border-b border-border',
        className,
      )}
    >
      {(title || actions) && (
        <header className="flex h-5 items-center justify-between">
          {title ? (
            <span className="select-none text-[11px] font-medium leading-none text-ink">
              {title}
            </span>
          ) : (
            <span />
          )}
          {actions ? <div className="flex items-center gap-0.5">{actions}</div> : null}
        </header>
      )}
      <div className="flex flex-col gap-1.5">{children}</div>
    </section>
  );
}
