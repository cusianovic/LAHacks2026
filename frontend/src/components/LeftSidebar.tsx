import { useMemo } from 'react';
import { Plus, Box, Database } from 'lucide-react';

import {
  useActiveFlow,
  useFlowActions,
  useFlowDispatch,
  useFlowState,
  useTaskByUses,
} from '@/state/flowStore';
import type { Flow, PublishStatus } from '@/types/pupload';

import { InspectorSection, IconButton } from '@/components/inspector';
import ListRow from '@/components/common/ListRow';
import StatusDot, { type SaveStatus } from '@/components/common/StatusDot';

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
// Rename / delete intentionally NOT in this base — wire them via the
// canvas-style right-click ContextMenu when you need them.
// =====================================================================

export default function LeftSidebar() {
  const { project, activeFlowName, publishStatus, selection } = useFlowState();
  const dispatch = useFlowDispatch();
  const actions = useFlowActions();
  const activeFlow = useActiveFlow();

  const handleAddFlow = () => {
    const baseName = `flow-${project.Flows.length + 1}`;
    dispatch({
      type: 'CREATE_FLOW',
      flow: { Name: baseName, Stores: [], DataWells: [], Steps: [] } satisfies Flow,
    });
  };

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
              <StepListRow
                key={`step:${step.ID}`}
                stepID={step.ID}
                uses={step.Uses}
                active={selection.type === 'step' && selection.id === step.ID}
                onClick={() => actions.selectElement({ type: 'step', id: step.ID })}
              />
            ))}
            {activeFlow.DataWells.map((well) => (
              <ListRow
                key={`well:${well.Edge}`}
                leading={<Database size={11} />}
                active={selection.type === 'datawell' && selection.id === well.Edge}
                onClick={() => actions.selectElement({ type: 'datawell', id: well.Edge })}
              >
                {well.Edge}
              </ListRow>
            ))}
          </>
        )}
      </InspectorSection>
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

// Tiny logo placeholder — swap the inner element for your real asset
// (e.g. an `<img src={pupload}/>` or an inline SVG).
function ProjectLogo() {
  return (
    <span
      aria-hidden
      className="flex h-[18px] w-[22px] shrink-0 items-center justify-center"
    >
      <Box size={14} className="text-ink" />
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

function StepListRow({
  stepID,
  uses,
  active,
  onClick,
}: {
  stepID: string;
  uses: string;
  active: boolean;
  onClick: () => void;
}) {
  const task = useTaskByUses(uses);
  const display = useMemo(() => {
    if (task) return task.Name;
    const [, name] = uses.split('/');
    return name || uses || stepID;
  }, [task, uses, stepID]);

  return (
    <ListRow active={active} onClick={onClick} leading={<Box size={11} />}>
      {display}
    </ListRow>
  );
}
