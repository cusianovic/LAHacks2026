import clsx from 'clsx';
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';

// =====================================================================
// ListRow — the unified "named-entity row" used everywhere we list:
//
//   left bar   : Flows, Layers/Steps
//   right bar  : Producers, Consumers, Stores, Data wells, …
//
// Visual (matches the Figma frame's `Test` row):
//
//   default                hover                   active (selected)
//   ┌────────────────┐    ┌────────────────┐      ╭────────────────╮
//   │  Test          │    │  Test          │      │  Test          │
//   └────────────────┘    └────────────────┘      ╰────────────────╯
//                          row-hover bg            row-active bg
//
// Always renders as a <button> for keyboard/click semantics.
//
// Props:
//   - `active`   highlight as currently selected
//   - `leading`  optional leading slot (icon, status dot, swatch)
//   - `trailing` optional trailing slot (count badge, action icons)
//   - `mono`     monospace value (e.g. step IDs)
// =====================================================================

interface ListRowProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean;
  leading?: ReactNode;
  trailing?: ReactNode;
  mono?: boolean;
  children: ReactNode;
}

const ListRow = forwardRef<HTMLButtonElement, ListRowProps>(function ListRow(
  { active, leading, trailing, mono, className, children, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      aria-pressed={active || undefined}
      className={clsx(
        // base
        'group flex h-5 w-full min-w-0 items-center gap-2 rounded-row px-1.5 text-left',
        'text-[10px] leading-none text-ink transition-colors',
        // typography weight matches Figma's `Geist Light 10px` for unselected,
        // bumped to `font-normal` when selected for a subtle weight cue.
        active ? 'bg-row-active font-medium' : 'font-light hover:bg-row-hover',
        mono && 'font-mono',
        className,
      )}
      {...rest}
    >
      {leading ? (
        <span className="flex shrink-0 items-center text-ink-dim">{leading}</span>
      ) : null}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {trailing ? (
        <span className="flex shrink-0 items-center gap-0.5 text-ink-dim opacity-0 group-hover:opacity-100">
          {trailing}
        </span>
      ) : null}
    </button>
  );
});

export default ListRow;
