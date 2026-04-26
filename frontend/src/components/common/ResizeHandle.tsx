import { useCallback, useEffect, useRef, useState } from 'react';
import clsx from 'clsx';

// =====================================================================
// ResizeHandle + useResizable — drag-to-resize primitives for the app
// shell's panels (left sidebar, right inspector, bottom YAML drawer).
//
// Architecture:
//   - `useResizable` owns the size state, persists it to localStorage,
//     clamps against min/max, and exposes a `pointerDown` handler.
//   - `ResizeHandle` is the visual stripe + hit area that calls the
//     handler. Components compose the two so the parent panel reads
//     `size` for its width/height style and renders a `<ResizeHandle>`
//     somewhere on its inner edge.
//
// Why a single shared file:
//   - The hook + handle are tightly coupled (axis, cursor, side) and
//     shipping them together keeps the call sites a one-liner.
//
// Persistence keys are namespaced under `pupload:resize:<key>` so they
// don't collide with the BFF localStorage cache (`pupload:draft:*`).
// =====================================================================

type Side = 'left' | 'right' | 'top';

const STORAGE_PREFIX = 'pupload:resize:';

function readPersisted(key: string | undefined, fallback: number): number {
  if (!key || typeof window === 'undefined') return fallback;
  try {
    const raw = window.localStorage.getItem(STORAGE_PREFIX + key);
    if (raw == null) return fallback;
    const n = Number(raw);
    return Number.isFinite(n) ? n : fallback;
  } catch {
    return fallback;
  }
}

function writePersisted(key: string | undefined, value: number): void {
  if (!key || typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_PREFIX + key, String(Math.round(value)));
  } catch {
    /* private mode / quota — silently drop, sizes just won't survive reload */
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

interface UseResizableOptions {
  /** Initial size in px when there's nothing in localStorage. */
  initial: number;
  /** Lower bound in px. The size will never go below this. */
  min: number;
  /** Upper bound in px. The size will never exceed this. */
  max: number;
  /** Drag axis: `x` for horizontal panels, `y` for the bottom drawer. */
  axis: 'x' | 'y';
  /**
   * If true, dragging in the negative axis direction GROWS the panel.
   * Use for panels whose anchor is on the trailing edge (right sidebar
   * grows as you drag leftwards; bottom drawer grows as you drag up).
   */
  invert?: boolean;
  /**
   * localStorage key suffix. Omit to make the size ephemeral (resets
   * every reload). When set, the latest size persists on pointer-up.
   */
  storageKey?: string;
}

export interface UseResizableResult {
  size: number;
  dragging: boolean;
  onPointerDown: (e: React.PointerEvent) => void;
}

export function useResizable({
  initial,
  min,
  max,
  axis,
  invert = false,
  storageKey,
}: UseResizableOptions): UseResizableResult {
  const [size, setSize] = useState<number>(() =>
    clamp(readPersisted(storageKey, initial), min, max),
  );
  const [dragging, setDragging] = useState(false);
  const sizeRef = useRef(size);
  useEffect(() => {
    sizeRef.current = size;
  }, [size]);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      // Don't let the drag start a text selection or steal focus from
      // form inputs in the panel.
      e.preventDefault();
      const startCoord = axis === 'x' ? e.clientX : e.clientY;
      const startSize = sizeRef.current;
      setDragging(true);

      const onMove = (m: PointerEvent) => {
        const cur = axis === 'x' ? m.clientX : m.clientY;
        const delta = invert ? startCoord - cur : cur - startCoord;
        setSize(clamp(startSize + delta, min, max));
      };
      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onUp);
        setDragging(false);
        // Persist exactly once at the end of the drag — keeps writes
        // off the hot path and avoids re-render churn from listeners
        // observing localStorage.
        writePersisted(storageKey, sizeRef.current);
      };

      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
    },
    [axis, invert, min, max, storageKey],
  );

  // Lock the body cursor + disable text selection during the drag so
  // the cursor doesn't flicker between elements when the pointer
  // crosses panel boundaries.
  useEffect(() => {
    if (!dragging) return;
    const prevCursor = document.body.style.cursor;
    const prevSelect = document.body.style.userSelect;
    document.body.style.cursor = axis === 'x' ? 'col-resize' : 'row-resize';
    document.body.style.userSelect = 'none';
    return () => {
      document.body.style.cursor = prevCursor;
      document.body.style.userSelect = prevSelect;
    };
  }, [dragging, axis]);

  // If min/max shrinks (e.g. browser window narrowed past the saved
  // size) re-clamp so the panel can never overflow its container.
  useEffect(() => {
    setSize((s) => clamp(s, min, max));
  }, [min, max]);

  return { size, dragging, onPointerDown };
}

interface ResizeHandleProps {
  /**
   * Which inner edge of the panel the handle sits on.
   * - `right`  → vertical stripe on the right edge (left sidebar)
   * - `left`   → vertical stripe on the left edge  (right sidebar)
   * - `top`    → horizontal stripe on the top edge (bottom drawer)
   */
  side: Side;
  onPointerDown: (e: React.PointerEvent) => void;
  /** Whether a drag is currently active — paints the stripe accent. */
  active?: boolean;
  className?: string;
}

// ResizeHandle is purely presentational; the hook holds all the state.
// It's positioned absolutely so the parent just needs `position: relative`
// (or an absolutely-positioned parent, like the YAML drawer). The hit
// area is 6px wide; the visible stripe is 1px and lights up on hover or
// while dragging so the user has a clear affordance without visual
// clutter when the panels are at rest.
export default function ResizeHandle({
  side,
  onPointerDown,
  active = false,
  className,
}: ResizeHandleProps) {
  const isHorizontal = side === 'top';
  return (
    <div
      role="separator"
      aria-orientation={isHorizontal ? 'horizontal' : 'vertical'}
      onPointerDown={onPointerDown}
      className={clsx(
        // 6px hit area straddling the panel edge. The negative offset
        // pulls half of it into the neighbouring region (canvas /
        // sidebar) so the handle isn't blocked by the panel's content
        // edge or border.
        'group absolute z-40 flex items-center justify-center',
        side === 'right' && '-right-[3px] top-0 bottom-0 w-1.5 cursor-col-resize',
        side === 'left' && '-left-[3px] top-0 bottom-0 w-1.5 cursor-col-resize',
        side === 'top' && '-top-[3px] left-0 right-0 h-1.5 cursor-row-resize',
        className,
      )}
    >
      {/* Visible 1px stripe centered in the hit area. Stays invisible
          at rest, becomes the brand accent on hover or while dragging. */}
      <div
        className={clsx(
          'transition-colors duration-150',
          isHorizontal ? 'h-px w-full' : 'h-full w-px',
          active ? 'bg-accent' : 'bg-transparent group-hover:bg-accent/60',
        )}
      />
    </div>
  );
}
