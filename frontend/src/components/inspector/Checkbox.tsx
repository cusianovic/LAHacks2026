import clsx from 'clsx';
import { Check } from 'lucide-react';
import {
  forwardRef,
  type InputHTMLAttributes,
  type ReactNode,
} from 'react';

// =====================================================================
// Checkbox — minimal Figma-style checkbox with inline label.
//
//   ☐ Clip content        ☑ Clip content
//
// The visible square is drawn ourselves so it can use our tokens; the
// real `<input type="checkbox">` is hidden but keyboard-accessible.
// =====================================================================

interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label?: ReactNode;
}

const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox(
  { label, className, checked, ...rest },
  ref,
) {
  return (
    <label
      className={clsx(
        'group inline-flex cursor-pointer select-none items-center gap-2 text-[11px] leading-none text-ink',
        rest.disabled && 'cursor-not-allowed opacity-60',
        className,
      )}
    >
      <input
        ref={ref}
        type="checkbox"
        checked={checked}
        className="sr-only"
        {...rest}
      />
      <span
        aria-hidden
        className={clsx(
          'flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[3px] border transition-colors',
          checked
            ? 'border-accent bg-accent text-ink'
            : 'border-border bg-raised group-hover:border-ink-dim',
        )}
      >
        {checked ? <Check size={10} strokeWidth={3} /> : null}
      </span>
      {label ? <span>{label}</span> : null}
    </label>
  );
});

export default Checkbox;
