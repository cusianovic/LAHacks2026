import { forwardRef, type InputHTMLAttributes } from 'react';
import clsx from 'clsx';

// =====================================================================
// TextInput — themed input. Use `mono` for code/value fields.
// =====================================================================

interface TextInputProps extends InputHTMLAttributes<HTMLInputElement> {
  mono?: boolean;
  invalid?: boolean;
}

const TextInput = forwardRef<HTMLInputElement, TextInputProps>(function TextInput(
  { mono, invalid, className, ...rest },
  ref,
) {
  return (
    <input
      ref={ref}
      className={clsx(
        'w-full h-8 px-2.5 rounded-row bg-raised border text-ink placeholder:text-ink-faint',
        'focus:outline-none focus:border-accent focus:bg-raised-hover',
        'transition-colors',
        invalid ? 'border-red-500/70' : 'border-border',
        mono && 'font-mono text-xs',
        className,
      )}
      {...rest}
    />
  );
});

export default TextInput;
