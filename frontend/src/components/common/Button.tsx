import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import clsx from 'clsx';

// =====================================================================
// Button — three intents: primary (brand), secondary (surface), ghost.
// Sizes: sm | md. Tweak here to retune the entire UI.
// =====================================================================

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
}

const VARIANT: Record<Variant, string> = {
  primary:
    'bg-accent text-ink hover:bg-accent-dim active:bg-accent disabled:opacity-60',
  secondary:
    'bg-raised text-ink hover:bg-raised-hover border border-border disabled:text-ink-faint',
  ghost:
    'text-ink-dim hover:text-ink hover:bg-raised disabled:text-ink-faint',
  danger:
    'bg-red-500/90 text-white hover:bg-red-500 active:bg-red-600',
};

const SIZE: Record<Size, string> = {
  sm: 'h-7 px-2.5 text-xs gap-1.5 rounded-md',
  md: 'h-9 px-3 text-sm gap-2 rounded-md',
};

const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', leftIcon, rightIcon, className, children, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      className={clsx(
        'inline-flex items-center justify-center font-medium tracking-tight transition-colors',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60',
        'disabled:cursor-not-allowed disabled:opacity-70',
        VARIANT[variant],
        SIZE[size],
        className,
      )}
      {...rest}
    >
      {leftIcon ? <span className="-ml-0.5 inline-flex">{leftIcon}</span> : null}
      {children}
      {rightIcon ? <span className="-mr-0.5 inline-flex">{rightIcon}</span> : null}
    </button>
  );
});

export default Button;
