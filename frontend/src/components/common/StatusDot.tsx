import clsx from 'clsx';

// =====================================================================
// StatusDot — tiny coloured dot for the project header.
//
//   ●  saved      ●  saving       ●  dirty      ●  error
//
// Per design: NO inline label. The status word only appears as the
// browser tooltip on hover (`title` attr) so the header stays clean.
//
// Colors come from CSS variables `--color-status-*`. To re-skin, edit
// those in `index.css` (or tweak per-instance via the optional `color`
// prop, which accepts any CSS color string).
// =====================================================================

export type SaveStatus = 'saved' | 'saving' | 'dirty' | 'error' | 'idle';

const LABELS: Record<SaveStatus, string> = {
  saved: 'Saved',
  saving: 'Saving…',
  dirty: 'Unsaved changes',
  error: 'Save failed',
  idle: 'Idle',
};

const COLOR_VAR: Record<SaveStatus, string> = {
  saved: 'var(--color-status-saved)',
  saving: 'var(--color-status-saving)',
  dirty: 'var(--color-status-dirty)',
  error: 'var(--color-status-error)',
  idle: 'var(--color-status-idle)',
};

interface StatusDotProps {
  status: SaveStatus;
  /** Override the color (any CSS color). Falls back to the status var. */
  color?: string;
  /** Override the tooltip label. */
  label?: string;
  className?: string;
  /** Pulse animation while saving. Default: true for `saving`. */
  pulse?: boolean;
}

export default function StatusDot({
  status,
  color,
  label,
  className,
  pulse,
}: StatusDotProps) {
  const willPulse = pulse ?? status === 'saving';
  return (
    <span
      role="status"
      title={label ?? LABELS[status]}
      aria-label={label ?? LABELS[status]}
      className={clsx(
        'inline-block h-1.5 w-1.5 shrink-0 rounded-full',
        willPulse && 'animate-pulse',
        className,
      )}
      style={{ backgroundColor: color ?? COLOR_VAR[status] }}
    />
  );
}
