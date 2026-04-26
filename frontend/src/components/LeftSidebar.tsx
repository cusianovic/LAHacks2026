import { useCallback, useMemo, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { Plus, Box, Database, Pencil, Trash2 } from 'lucide-react';

import {
  useActiveFlow,
  useFlowActions,
  useFlowDispatch,
  useFlowState,
} from '@/state/flowStore';
import type { Flow, PublishStatus } from '@/types/pupload';

import { InspectorSection, IconButton } from '@/components/inspector';
import ListRow from '@/components/common/ListRow';
import PuploadLogo from '@/components/icons/PuploadLogo';
import StatusDot, { type SaveStatus } from '@/components/common/StatusDot';
import ContextMenu, { type ContextMenuItem } from '@/components/canvas/ContextMenu';

// =====================================================================
// LeftSidebar — Figma-style navigation rail.
//
//   ┌──────────────────────────────────┐
//   │ ◉  Project Name              ●   │  ← project header w/ status dot
//   ├──────────────────────────────────┤
//   │ Flows                       +    │  ← InspectorSection
//   │   Test                            │
//   │   another flow                    │  ← ListRow
//   ├──────────────────────────────────┤
//   │ Items                             │
//   │   ▣ step-1                        │
//   │   ▣ step-2                        │
//   │   ⛁ well-a                        │
//   └──────────────────────────────────┘
//
// All entity interactions come from `useFlowActions` / `useFlowDispatch`.
// Right-click on any flow / step / datawell row opens the same
// `ContextMenu` the canvas uses. Steps get Rename + Delete; flows and
// datawells get Delete only. The Items list shows each step's `ID` (the
// stable identifier the controller uses), not the underlying task name,
// so renames are visible immediately without having to open the inspector.
// =====================================================================

// Discriminated state for the right-click menu. `null` = closed.
// Coordinates come straight from `clientX/clientY` so the menu lands
// under the cursor regardless of scroll position inside the rail.
type MenuState =
  | { kind: 'flow'; name: string; x: number; y: number }
  | { kind: 'step'; id: string; x: number; y: number }
  | { kind: 'datawell'; edge: string; x: number; y: number };

export default function LeftSidebar() {
  const { project, activeFlowName, publishStatus, selection } = useFlowState();
  const dispatch = useFlowDispatch();
  const actions = useFlowActions();
  const activeFlow = useActiveFlow();

  const [menu, setMenu] = useState<MenuState | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);

  const handleAddFlow = () => {
    const baseName = `flow-${project.Flows.length + 1}`;
    dispatch({
      type: 'CREATE_FLOW',
      flow: { Name: baseName, Stores: [], DataWells: [], Steps: [] } satisfies Flow,
    });
  };

  // Build the menu items for whichever row was right-clicked. Memoised
  // so the ContextMenu doesn't churn its item list on unrelated re-renders.
  const menuItems = useMemo<ContextMenuItem[]>(() => {
    if (!menu) return [];
    switch (menu.kind) {
      case 'flow':
        return [
          {
            label: 'Delete flow',
            icon: <Trash2 size={13} />,
            danger: true,
            onClick: () => actions.deleteFlow(menu.name),
          },
        ];
      case 'step':
        return [
          {
            label: 'Rename step',
            icon: <Pencil size={13} />,
            // window.prompt is the smallest possible UX that doesn't add
            // new components / state. The reducer (RENAME_STEP) already
            // validates uniqueness and silently ignores empty / duplicate
            // input, so the prompt itself stays dumb.
            onClick: () => {
              const next = window.prompt('Rename step', menu.id);
              if (next == null) return; // user cancelled
              const trimmed = next.trim();
              if (trimmed === '' || trimmed === menu.id) return;
              actions.renameStep(menu.id, trimmed);
            },
          },
          {
            label: 'Delete step',
            icon: <Trash2 size={13} />,
            danger: true,
            onClick: () => actions.deleteStep(menu.id),
          },
        ];
      case 'datawell':
        return [
          {
            label: 'Delete data well',
            icon: <Trash2 size={13} />,
            danger: true,
            onClick: () => actions.deleteDataWell(menu.edge),
          },
        ];
    }
  }, [menu, actions]);

  return (
    <div className="flex h-full flex-col">
      <ProjectHeader name={project.ID || 'Project Name'} publishStatus={publishStatus} />

      <InspectorSection
        title="Flows"
        actions={
          <IconButton
            size="sm"
            aria-label="Add flow"
            onClick={handleAddFlow}
            icon={<Plus size={12} />}
          />
        }
      >
        {project.Flows.length === 0 ? (
          <EmptyHint>No flows yet.</EmptyHint>
        ) : (
          project.Flows.map((flow) => (
            <ListRow
              key={flow.Name}
              active={flow.Name === activeFlowName}
              onClick={() => actions.selectFlow(flow.Name)}
              onContextMenu={(e: ReactMouseEvent) => {
                // Right-click opens the menu only — it must NOT mutate
                // selection, otherwise it would behave like a left click.
                e.preventDefault();
                setMenu({ kind: 'flow', name: flow.Name, x: e.clientX, y: e.clientY });
              }}
            >
              {flow.Name}
            </ListRow>
          ))
        )}
      </InspectorSection>

      <InspectorSection title="Items" bare className="flex-1 overflow-auto">
        {!activeFlow || (activeFlow.Steps.length === 0 && activeFlow.DataWells.length === 0) ? (
          <EmptyHint>
            {activeFlow ? 'Add items from the bottom toolbar.' : 'Select a flow above.'}
          </EmptyHint>
        ) : (
          <>
            {activeFlow.Steps.map((step) => (
              <ListRow
                key={`step:${step.ID}`}
                leading={<Box size={11} />}
                active={selection.type === 'step' && selection.id === step.ID}
                onClick={() => actions.selectElement({ type: 'step', id: step.ID })}
                onContextMenu={(e: ReactMouseEvent) => {
                  e.preventDefault();
                  setMenu({ kind: 'step', id: step.ID, x: e.clientX, y: e.clientY });
                }}
              >
                {step.ID}
              </ListRow>
            ))}
            {activeFlow.DataWells.map((well) => (
              <ListRow
                key={`well:${well.Edge}`}
                leading={<Database size={11} />}
                active={selection.type === 'datawell' && selection.id === well.Edge}
                onClick={() => actions.selectElement({ type: 'datawell', id: well.Edge })}
                onContextMenu={(e: ReactMouseEvent) => {
                  e.preventDefault();
                  setMenu({ kind: 'datawell', edge: well.Edge, x: e.clientX, y: e.clientY });
                }}
              >
                {well.Edge}
              </ListRow>
            ))}
          </>
        )}
      </InspectorSection>

      {menu ? (
        <ContextMenu x={menu.x} y={menu.y} items={menuItems} onClose={closeMenu} />
      ) : null}
    </div>
  );
}

/* --------------------------- header -------------------------------- */

interface ProjectHeaderProps {
  name: string;
  publishStatus: PublishStatus;
}

// Project header — exactly the Figma layout: logo (small square box) +
// project name + a tiny status dot on the right. Status text only shows
// as the browser tooltip on hover.
function ProjectHeader({ name, publishStatus }: ProjectHeaderProps) {
  const status = publishStatusToSaveStatus(publishStatus);
  return (
    <header className="flex items-center gap-2 border-b border-border px-2 pb-3 pt-2">
      <ProjectLogo />
      <span className="min-w-0 flex-1 truncate text-[13px] font-medium leading-none text-ink">
        {name}
      </span>
      <StatusDot status={status} />
    </header>
  );
}

// Pupload mark in the project header. White on the dark chrome —
// `currentColor` flows through `PuploadLogo`'s `fill`. The full-colour
// (accent green) variant is intended for marketing/auth surfaces;
// switch the wrapper's text colour there.
function ProjectLogo() {
  return (
    <span
      aria-hidden
      className="flex h-[18px] w-[22px] shrink-0 items-center justify-center text-white"
    >
      <PuploadLogo className="h-full w-auto" />
    </span>
  );
}

/** Project-level publish status → header save-dot status. */
function publishStatusToSaveStatus(p: PublishStatus): SaveStatus {
  switch (p) {
    case 'published':
      return 'saved';
    case 'unpublished_changes':
      return 'dirty';
    case 'not_published':
      return 'idle';
    default:
      return 'idle';
  }
}

/* ----------------------- list helpers ------------------------------ */

function EmptyHint({ children }: { children: React.ReactNode }) {
  return (
    <p className="px-1.5 py-1 text-[10px] font-light leading-none text-ink-faint">
      {children}
    </p>
  );
}

