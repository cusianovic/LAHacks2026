import type { ReactNode } from 'react';

import LeftSidebar from '@/components/LeftSidebar';
import RightPanel from '@/components/right/RightPanel';
import BottomBar from '@/components/bottom/BottomBar';
import YamlPanel from '@/components/bottom/YamlPanel';
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
// To re-skin: edit `--color-*` variables in `index.css`.
// To resize panes: edit `LEFT_WIDTH` / `RIGHT_WIDTH` below.
// =====================================================================

const LEFT_WIDTH = 240;
const RIGHT_WIDTH = 280;

interface AppShellProps {
  children: ReactNode;
}

export default function AppShell({ children }: AppShellProps) {
  const { yamlPanel, status, error } = useFlowState();

  return (
    <div className="flex h-full w-full bg-chrome font-sans text-ink">
      {/* Left sidebar — flush with the viewport, hairline border on the
          right edge. The colour step (chrome → canvas) is what actually
          reads as the boundary. */}
      <aside
        className="shrink-0 border-r border-border bg-chrome"
        style={{ width: LEFT_WIDTH }}
      >
        <LeftSidebar />
      </aside>

      {/* Canvas — the LIGHT plane that hosts ReactFlow plus all
          canvas-overlay UI (floating pill, YAML slide-up). */}
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

        {/* Floating bottom toolbar, centered. Wrapper is non-interactive
            so clicks in the gap on either side still hit the canvas. */}
        <div className="pointer-events-none absolute inset-x-0 bottom-5 z-30 flex justify-center">
          <BottomBar />
        </div>
      </main>

      {/* Right inspector — flush with viewport, hairline border on the
          left edge. */}
      <aside
        className="shrink-0 border-l border-border bg-chrome"
        style={{ width: RIGHT_WIDTH }}
      >
        <RightPanel />
      </aside>
    </div>
  );
}
