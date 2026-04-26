import { useEffect, useRef, type ReactNode } from 'react';
import clsx from 'clsx';

// =====================================================================
// Popover — dismissable floating panel used by Add Step / Add DataWell.
// Click outside, Escape, or call `onClose` to dismiss.
// =====================================================================

interface PopoverProps {
  open: boolean;
  onClose: () => void;
  anchor?: 'top' | 'bottom';
  className?: string;
  children: ReactNode;
}

export default function Popover({ open, onClose, anchor = 'top', className, children }: PopoverProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    const onClick = (e: MouseEvent) => {
      if (!ref.current) return;
      if (ref.current.contains(e.target as Node)) return;
      onClose();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onClick);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onClick);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      ref={ref}
      className={clsx(
        'absolute z-30 w-72 rounded-row border border-border bg-chrome p-3 shadow-pill',
        anchor === 'top' ? 'bottom-12 left-0' : 'top-12 left-0',
        className,
      )}
    >
      {children}
    </div>
  );
}
