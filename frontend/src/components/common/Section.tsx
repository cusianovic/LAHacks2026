import clsx from 'clsx';
import type { ReactNode } from 'react';

// =====================================================================
// Section — Figma-style labeled group.
//
// Two visual modes:
//   - default        : just spacing, no chrome (used when the parent
//                      already provides borders, e.g. inside the
//                      sidebars where rows separate themselves).
//   - divided=true   : adds a top border + uniform vertical padding,
//                      so stacking multiple `<Section divided>` cards
//                      produces Figma's "Page / Variables / Styles /
//                      Export" rhythm with hairline separators.
//
// Use `dense` to tighten gap inside the body (no effect on chrome).
// Use `action` for the header's right-side content (e.g. `+` button).
// =====================================================================

interface SectionProps {
  title?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  dense?: boolean;
  /** Adds top hairline + uniform padding so siblings stack with dividers. */
  divided?: boolean;
}

export default function Section({
  title,
  action,
  children,
  className,
  dense,
  divided,
}: SectionProps) {
  return (
    <section
      className={clsx(
        'flex flex-col',
        dense ? 'gap-1.5' : 'gap-2',
        divided && 'border-t border-border px-3 py-3 first:border-t-0',
        className,
      )}
    >
      {(title || action) && (
        <header className="flex items-center justify-between text-[11px] font-medium text-ink-dim">
          <span className="select-none">{title}</span>
          {action ? <span className="flex items-center gap-1">{action}</span> : null}
        </header>
      )}
      <div className={clsx('flex flex-col', dense ? 'gap-1.5' : 'gap-2')}>{children}</div>
    </section>
  );
}
