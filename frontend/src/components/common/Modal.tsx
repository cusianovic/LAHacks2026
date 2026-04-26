import { useEffect, type ReactNode } from 'react';
import clsx from 'clsx';
import { X } from 'lucide-react';

// =====================================================================
// Modal — center-screen dialog. Click backdrop or press Esc to close.
// =====================================================================

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'md' | 'lg';
}

const SIZE = {
  md: 'max-w-lg',
  lg: 'max-w-2xl',
};

export default function Modal({ open, onClose, title, children, footer, size = 'lg' }: ModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    // `pointer-events-auto` is intentional: this modal can be rendered
    // inside subtrees that opt out of hit testing (e.g. the floating
    // BottomBar wrapper uses `pointer-events-none` so empty space
    // around the pill stays clickable on the canvas). Without this,
    // the modal would inherit `none` and clicks would fall through.
    <div className="pointer-events-auto fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden
      />
      <div
        className={clsx(
          'relative z-10 w-full rounded-row border border-border bg-chrome shadow-pill',
          'mx-4 flex flex-col max-h-[80vh]',
          SIZE[size],
        )}
        role="dialog"
        aria-modal
      >
        <header className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="text-sm font-medium text-ink">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-row p-1 text-ink-dim hover:bg-raised-hover hover:text-ink"
            aria-label="Close"
          >
            <X size={14} />
          </button>
        </header>
        <div className="flex-1 overflow-auto p-4">{children}</div>
        {footer ? <footer className="border-t border-border px-4 py-3">{footer}</footer> : null}
      </div>
    </div>
  );
}
