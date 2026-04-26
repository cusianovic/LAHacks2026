import clsx from 'clsx';
import type { ReactNode } from 'react';

// =====================================================================
// IconButtonGroup — segmented control of `IconButton`s.
//
// Visually a single rounded container with no gap between the buttons,
// used for things like the Alignment row in Figma's Position panel:
//
//   ┌─────┬─────┬─────┐  ┌─────┬─────┬─────┐
//   │  ◄  │  ▬  │  ►  │  │  ▲  │  ─  │  ▼  │
//   └─────┴─────┴─────┘  └─────┴─────┴─────┘
//
// The hairline between buttons comes from each button's right border
// (added here via Tailwind's child selectors), keeping callers clean.
//
// Pass `children={<IconButton ... />}` for each segment. Mark one as
// `active` to give it the pressed state.
// =====================================================================

interface IconButtonGroupProps {
  children: ReactNode;
  className?: string;
  /** Renders without the outer container fill — for inline action rows. */
  bare?: boolean;
}

export default function IconButtonGroup({
  children,
  className,
  bare,
}: IconButtonGroupProps) {
  return (
    <div
      role="group"
      className={clsx(
        'inline-flex overflow-hidden rounded-row',
        bare ? 'gap-0.5' : 'bg-raised p-0.5',
        className,
      )}
    >
      {children}
    </div>
  );
}
