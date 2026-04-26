import { useEffect, useRef, type ReactNode } from 'react';
import clsx from 'clsx';

// =====================================================================
// ContextMenu — small floating menu shown at a click point.
//
// Used by FlowCanvas for right-click actions on steps, data wells,
// and edges. Generic on purpose so the same component can drive a
// future pane right-click ("Add step here", "Paste", ...).
//
// Positioning:
//   - Uses `position: fixed` with raw `x`/`y` from `clientX/clientY`,
//     so the menu lands under the cursor regardless of canvas pan/zoom.
//   - Naive overflow guard: if the menu would clip the right/bottom
//     edge of the viewport, it flips toward the cursor's other side.
//
// Dismissal:
//   - Click outside, Escape, or selecting an item closes the menu.
//   - Items receive a callback invoked before close, so they can
//     dispatch store actions safely.
//   - Listeners run in the CAPTURE phase and on `pointerdown` (not just
//     `mousedown`). React Flow's pane / node handlers call
//     `stopPropagation` on native pointer events for pan/drag handling,
//     which would otherwise prevent the bubble from ever reaching the
//     window. Capture-phase listeners fire before any element handler
//     can stop the event, so the menu reliably closes when the user
//     clicks anywhere outside it — including on the React Flow canvas.
// =====================================================================

export interface ContextMenuItem {
  label: string;
  icon?: ReactNode;
  onClick: () => void;
  danger?: boolean;
  shortcut?: string;
  disabled?: boolean;
}

interface ContextMenuProps {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}

const MENU_WIDTH = 180;
const ITEM_HEIGHT = 28;
const VERTICAL_PADDING = 8;

export default function ContextMenu({ x, y, items, onClose }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);

  // Dismiss on outside click / Escape. See header comment for why this
  // listens in the capture phase on `pointerdown` (and `mousedown` as a
  // fallback for non-pointer-event environments).
  useEffect(() => {
    const onDown = (e: Event) => {
      if (!ref.current) return;
      const target = e.target as Node | null;
      if (target && ref.current.contains(target)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('mousedown', onDown, true);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('mousedown', onDown, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  // Naive viewport-edge guard. Estimate the menu's box from the item
  // count and flip if it would overflow.
  const estimatedHeight = items.length * ITEM_HEIGHT + VERTICAL_PADDING;
  const left = x + MENU_WIDTH > window.innerWidth ? x - MENU_WIDTH : x;
  const top = y + estimatedHeight > window.innerHeight ? y - estimatedHeight : y;

  return (
    <div
      ref={ref}
      role="menu"
      style={{ left, top, minWidth: MENU_WIDTH }}
      className="fixed z-50 overflow-hidden rounded-row border border-border bg-chrome py-1 shadow-pill"
    >
      {items.map((item, i) => (
        <button
          key={i}
          type="button"
          role="menuitem"
          disabled={item.disabled}
          onClick={() => {
            if (item.disabled) return;
            item.onClick();
            onClose();
          }}
          className={clsx(
            'flex w-full items-center justify-between gap-3 px-2.5 py-1.5 text-left text-[12px] transition-colors',
            item.disabled
              ? 'cursor-not-allowed text-ink-faint'
              : item.danger
              ? 'text-red-300 hover:bg-red-500/15 hover:text-red-200'
              : 'text-ink hover:bg-raised-hover',
          )}
        >
          <span className="flex items-center gap-2">
            {item.icon ? <span className="shrink-0">{item.icon}</span> : null}
            {item.label}
          </span>
          {item.shortcut ? (
            <kbd className="font-mono text-[10px] text-ink-faint">{item.shortcut}</kbd>
          ) : null}
        </button>
      ))}
    </div>
  );
}
