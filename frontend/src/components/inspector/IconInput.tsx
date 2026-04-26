import clsx from 'clsx';
import {
  forwardRef,
  type InputHTMLAttributes,
  type ReactNode,
} from 'react';

// =====================================================================
// IconInput — Figma-style compact input with a leading prefix.
//
//   ┌────────────────────────────────────┐
//   │ X  2291                            │   prefix="X"
//   ├────────────────────────────────────┤
//   │ 󰡟  100                       %    │   prefix=<icon/>, suffix="%"
//   └────────────────────────────────────┘
//
// Rendered on top of a `bg-raised` (#383838) fill so it reads as inset
// against the chrome (#2c2c2c) panel. White value text, ink-faint prefix.
//
// Props you'll reach for most:
//   - `prefix`     — single character or icon shown left of the value
//   - `suffix`     — single character or icon shown right of the value
//   - `mono`       — switch to JetBrains Mono for the value
//   - everything else is a normal `<input>` prop
// =====================================================================

interface IconInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'prefix'> {
  prefix?: ReactNode;
  suffix?: ReactNode;
  mono?: boolean;
  /** Visual variant. `flat` removes the inset fill (e.g. inline list rows). */
  variant?: 'inset' | 'flat';
}

const IconInput = forwardRef<HTMLInputElement, IconInputProps>(function IconInput(
  { prefix, suffix, mono, variant = 'inset', className, disabled, ...rest },
  ref,
) {
  return (
    <label
      className={clsx(
        'group flex h-6 min-w-0 flex-1 items-center gap-1.5 rounded-row px-1.5',
        variant === 'inset'
          ? 'bg-raised hover:bg-raised-hover focus-within:bg-raised-hover'
          : 'hover:bg-row-hover focus-within:bg-row-hover',
        'focus-within:ring-1 focus-within:ring-accent transition-colors',
        // Disabled rows show through but stop interacting. We dim the
        // whole label so the prefix and value read as a single unit.
        disabled && 'cursor-not-allowed opacity-60 hover:bg-raised focus-within:bg-raised focus-within:ring-0',
        className,
      )}
    >
      {prefix ? (
        <span className="shrink-0 select-none text-[11px] leading-none text-ink-faint">
          {prefix}
        </span>
      ) : null}
      <input
        ref={ref}
        disabled={disabled}
        {...rest}
        className={clsx(
          'min-w-0 flex-1 bg-transparent text-[11px] leading-none text-ink outline-none placeholder:text-ink-faint',
          'disabled:cursor-not-allowed',
          mono && 'font-mono',
        )}
      />
      {suffix ? (
        <span className="shrink-0 select-none text-[11px] leading-none text-ink-faint">
          {suffix}
        </span>
      ) : null}
    </label>
  );
});

export default IconInput;
