import clsx from 'clsx';
import type { ReactNode } from 'react';

// =====================================================================
// SwatchRow — colour/value row, mirroring Figma's Fill / Stroke rows.
//
//   ┌───────────────────────────────────────────────┐
//   │ ▢  Secondary Color           100   👁  ─       │
//   └───────────────────────────────────────────────┘
//      ↑   ↑                       ↑    ↑   ↑
//    swatch  label              opacity actions...
//
// All children except `swatchColor` and `label` are slot-style:
//   - `value`    → renders to the right of the label (e.g. opacity %)
//   - `actions`  → trailing icon row
//
// Use it for fill/stroke style, but also for any "named token" row
// where you want a colour preview + actions.
// =====================================================================

interface SwatchRowProps {
  /** CSS color string. Use a variable like `var(--color-chrome)` to
   *  preview a token, or any literal hex / rgba. */
  swatchColor: string;
  label: ReactNode;
  value?: ReactNode;
  actions?: ReactNode;
  className?: string;
  onClick?: () => void;
}

export default function SwatchRow({
  swatchColor,
  label,
  value,
  actions,
  className,
  onClick,
}: SwatchRowProps) {
  return (
    <div
      className={clsx(
        'flex h-7 items-center gap-2 rounded-row px-1.5',
        'bg-raised hover:bg-raised-hover transition-colors',
        onClick && 'cursor-pointer',
        className,
      )}
      onClick={onClick}
    >
      {/* swatch — 12×12 square, hairline border so light values stay visible */}
      <span
        className="block h-3 w-3 shrink-0 rounded-[3px] border border-border"
        style={{ backgroundColor: swatchColor }}
      />
      <span className="min-w-0 flex-1 truncate text-[11px] leading-none text-ink">
        {label}
      </span>
      {value ? (
        <span className="shrink-0 text-[11px] leading-none text-ink-dim">
          {value}
        </span>
      ) : null}
      {actions ? (
        <span className="ml-1 flex shrink-0 items-center gap-0.5">{actions}</span>
      ) : null}
    </div>
  );
}
