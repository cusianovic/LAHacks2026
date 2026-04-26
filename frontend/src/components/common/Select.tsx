import { forwardRef, type SelectHTMLAttributes } from 'react';
import clsx from 'clsx';

// =====================================================================
// Select — themed select. Pass <option> children as usual.
// =====================================================================

const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  function Select({ className, children, ...rest }, ref) {
    return (
      <select
        ref={ref}
        className={clsx(
          'w-full h-8 px-2 pr-7 rounded-row bg-raised border border-border text-ink text-sm',
          'focus:outline-none focus:border-accent focus:bg-raised-hover',
          'appearance-none bg-no-repeat',
          className,
        )}
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%239aa0ad' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><polyline points='6 9 12 15 18 9'/></svg>\")",
          backgroundPosition: 'right 8px center',
          backgroundSize: '12px 12px',
        }}
        {...rest}
      >
        {children}
      </select>
    );
  },
);

export default Select;
