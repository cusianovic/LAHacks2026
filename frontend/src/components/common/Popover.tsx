import { useEffect, useRef, type ReactNode, type RefObject } from 'react';
import clsx from 'clsx';

// =====================================================================
// Popover — dismissable floating panel used by Add Step / Add DataWell.
// Click outside, Escape, or call `onClose` to dismiss.
//
// Anchor handling:
//   When a Popover is paired with a toggle button, clicks on that button
//   should NOT trigger the outside-click dismissal — otherwise re-clicking
//   the trigger would cause a state race:
//     1. mousedown → window listener fires → onClose() → state false
//     2. click → button onClick → toggle → state true (popover re-opens)
//   Pass the trigger element (or its wrapper) via `anchorRef` and clicks
//   inside it are treated as "inside" the popover, so only the button's
//   own onClick controls open/close — making the toggle behave like a
//   real toggle.
// =====================================================================

interface PopoverProps {
  open: boolean;
  onClose: () => void;
  anchor?: 'top' | 'bottom';
  className?: string;
  /** Optional element treated as "inside" the popover for outside-click
   *  dismissal — typically the trigger button or its wrapper. */
  anchorRef?: RefObject<HTMLElement | null>;
  children: ReactNode;
}

export default function Popover({ open, onClose, anchor = 'top', className, anchorRef, children }: PopoverProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    const onClick = (e: MouseEvent) => {
      if (!ref.current) return;
      const target = e.target as Node | null;
      if (!target) return;
      if (ref.current.contains(target)) return;
      if (anchorRef?.current?.contains(target)) return;
      onClose();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onClick);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onClick);
    };
  }, [open, onClose, anchorRef]);

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
