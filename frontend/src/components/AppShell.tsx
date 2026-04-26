import type { ReactNode } from 'react';

import LeftSidebar from '@/components/LeftSidebar';
import RightPanel from '@/components/right/RightPanel';
import BottomBar from '@/components/bottom/BottomBar';
import YamlPanel from '@/components/bottom/YamlPanel';
import ResizeHandle, { useResizable } from '@/components/common/ResizeHandle';
import { useFlowState } from '@/state/flowStore';

// =====================================================================
// AppShell — Figma-style flat three-pane layout.
//
//   ┌──────────┬────────────────────────────────────┬───────────┐
//   │          │                                    │           │
//   │  Left    │      Canvas  (canvas — light)      │  Right    │
//   │  side    │                                    │  panel    │
//   │  bar     │   ┌─ floating pill ─┐              │           │
//   │ (chrome) │   │ + S | + DW | AI │              │ (chrome)  │
//   │          │   └─────────────────┘              │           │
//   │          │                                    │           │
//   └──────────┴────────────────────────────────────┴───────────┘
//
// Design intent (Figma):
//   - NO outer gutter, NO rounded card chrome. Sidebars run from the
//     very top of the viewport to the very bottom and sit flush
//     against the screen edges.
//   - Canvas is LIGHT (`canvas` token, #d7d7d7); sidebars are DARK
//     (`chrome` token, #2c2c2c). Hairline `border` (#666363) seam.
//   - Project info / status live INSIDE the left sidebar header,
//     not in a separate top bar (matching Figma's pattern).
//   - The bottom toolbar floats inside the canvas region — same as
//     Figma's bottom tools pill.
//
// Resizing:
//   - Each sidebar carries a `ResizeHandle` straddling its inner edge.
//     `useResizable` owns the px width (clamped to LEFT_/RIGHT_BOUNDS)
//     and persists the latest value to localStorage so the layout
//     survives reloads.
//   - The bottom YAML drawer ships its own handle; see `YamlPanel`.
//
// To re-skin: edit `--color-*` variables in `index.css`.
// To change defaults / bounds: edit the constants below.
// =====================================================================

const LEFT_DEFAULT = 240;
const LEFT_MIN = 180;
const LEFT_MAX = 480;

const RIGHT_DEFAULT = 280;
const RIGHT_MIN = 220;
const RIGHT_MAX = 560;

interface AppShellProps {
  children: ReactNode;
}

export default function AppShell({ children }: AppShellProps) {
  const { yamlPanel, status, error } = useFlowState();

  const left = useResizable({
    initial: LEFT_DEFAULT,
    min: LEFT_MIN,
    max: LEFT_MAX,
    axis: 'x',
    storageKey: 'left-sidebar',
  });

  const right = useResizable({
    initial: RIGHT_DEFAULT,
    min: RIGHT_MIN,
    max: RIGHT_MAX,
    axis: 'x',
    // Right sidebar grows as the user drags leftward (its inner edge
    // is on the left), so flip the axis sign.
    invert: true,
    storageKey: 'right-sidebar',
  });

  return (
    <div className="flex h-full w-full bg-chrome font-sans text-ink">
      {/* Left sidebar — flush with the viewport, hairline border on the
          right edge. The colour step (chrome → canvas) is what actually
          reads as the boundary. */}
      <aside
        className="relative shrink-0 border-r border-border bg-chrome"
        style={{ width: left.size }}
      >
        <LeftSidebar />
        <ResizeHandle side="right" onPointerDown={left.onPointerDown} active={left.dragging} />
      </aside>

      {/* Canvas — the LIGHT plane that hosts ReactFlow plus all
          canvas-overlay UI (YAML slide-up). The floating BottomBar is
          rendered OUTSIDE main (see below) so its center anchors to the
          viewport, not to the canvas — that way resizing either sidebar
          doesn't shift the toolbar. */}
      <main className="relative flex-1 min-w-0 overflow-hidden bg-canvas">
        {status === 'error' ? (
          <div className="flex h-full items-center justify-center p-8 text-center">
            <div>
              <p className="text-sm text-status-error">Failed to load project</p>
              <p className="mt-1 text-xs text-ink-inverse/70">{error ?? 'Unknown error'}</p>
            </div>
          </div>
        ) : (
          <div className="absolute inset-0">{children}</div>
        )}

        {/* YAML slide-up overlay (z-20) sits below the floating pill. */}
        {yamlPanel.open ? <YamlPanel /> : null}
      </main>

      {/* Right inspector — flush with viewport, hairline border on the
          left edge. */}
      <aside
        className="relative shrink-0 border-l border-border bg-chrome"
        style={{ width: right.size }}
      >
        <RightPanel />
        <ResizeHandle side="left" onPointerDown={right.onPointerDown} active={right.dragging} />
      </aside>

      {/* Floating bottom toolbar — viewport-fixed and centered. Sitting
          OUTSIDE `<main>` is intentional: when the user resizes the
          sidebars, `<main>`'s center moves, but `position: fixed`
          anchors to the viewport so the pill stays put.
          - `pointer-events-none` on the wrapper lets clicks fall through
            to the canvas in the gap on either side of the pill; the
            pill itself sets `pointer-events-auto` to remain clickable.
          - z-30 keeps it above the YAML drawer (z-20). */}
      <div className="pointer-events-none fixed inset-x-0 bottom-5 z-30 flex justify-center">
        <BottomBar />
      </div>
    </div>
  );
}
