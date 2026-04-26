import clsx from 'clsx';
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';

// =====================================================================
// IconButton — square icon button used inside InspectorSection actions
// rows and inside IconButtonGroup (segmented controls).
//
//   default     hover         active (pressed)
//   ┌────┐      ┌────┐         ┌────┐
//   │ ▸  │      │ ▸  │  bg     │ ▸  │  bg + ink
//   └────┘      └────┘         └────┘
//
// Sizes:
//   sm  → 20×20 (used in section header action rows)
//   md  → 24×24 (default, used in segmented groups)
// =====================================================================

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon?: ReactNode;
  size?: 'sm' | 'md';
  /** Renders as if "pressed" — used by segmented controls. */
  active?: boolean;
  /** Tighten the visual weight (transparent until hover). */
  ghost?: boolean;
}

const SIZE = {
  sm: 'h-5 w-5',
  md: 'h-6 w-6',
};

const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { icon, size = 'md', active, ghost = true, className, children, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      aria-pressed={active || undefined}
      className={clsx(
        'inline-flex shrink-0 items-center justify-center rounded-row text-ink-dim transition-colors',
        SIZE[size],
        active
          ? 'bg-raised-strong text-ink'
          : ghost
          ? 'hover:bg-raised hover:text-ink'
          : 'bg-raised hover:bg-raised-hover hover:text-ink',
        'focus:outline-none focus-visible:ring-1 focus-visible:ring-accent',
        className,
      )}
      {...rest}
    >
      {icon ?? children}
    </button>
  );
});

export default IconButton;
