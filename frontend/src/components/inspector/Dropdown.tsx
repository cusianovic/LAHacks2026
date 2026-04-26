import clsx from 'clsx';
import { ChevronDown } from 'lucide-react';
import { forwardRef, type SelectHTMLAttributes, type ReactNode } from 'react';

// =====================================================================
// Dropdown — Figma-style compact <select>.
//
//   ┌──────────────────────────────────┐
//   │ Inside                       ▾   │
//   └──────────────────────────────────┘
//
// Built on a real `<select>` so keyboard nav / native option list work.
// We hide the platform chevron and render our own.
//
// Pass `<option>` children. Optional `prefix` for a leading icon/char
// (mirrors the IconInput shape).
// =====================================================================

interface DropdownProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'prefix'> {
  prefix?: ReactNode;
  variant?: 'inset' | 'flat';
}

const Dropdown = forwardRef<HTMLSelectElement, DropdownProps>(function Dropdown(
  { prefix, variant = 'inset', className, children, disabled, ...rest },
  ref,
) {
  return (
    <div
      className={clsx(
        'group relative flex h-6 min-w-0 flex-1 items-center gap-1.5 rounded-row pl-1.5 pr-1',
        variant === 'inset'
          ? 'bg-raised hover:bg-raised-hover focus-within:bg-raised-hover'
          : 'hover:bg-row-hover focus-within:bg-row-hover',
        'focus-within:ring-1 focus-within:ring-accent transition-colors',
        disabled && 'cursor-not-allowed opacity-60 hover:bg-raised focus-within:bg-raised focus-within:ring-0',
        className,
      )}
    >
      {prefix ? (
        <span className="pointer-events-none shrink-0 select-none text-[11px] leading-none text-ink-faint">
          {prefix}
        </span>
      ) : null}
      <select
        ref={ref}
        disabled={disabled}
        {...rest}
        className="min-w-0 flex-1 cursor-pointer appearance-none bg-transparent pr-4 text-[11px] leading-none text-ink outline-none disabled:cursor-not-allowed"
      >
        {children}
      </select>
      <ChevronDown
        size={12}
        className="pointer-events-none absolute right-1 text-ink-faint group-hover:text-ink-dim"
      />
    </div>
  );
});

export default Dropdown;
