import { useMemo } from 'react';
import { Trash2 } from 'lucide-react';

import {
  useActiveFlow,
  useFlowActions,
  useTaskByUses,
  useTasks,
} from '@/state/flowStore';
import {
  InspectorSection,
  InspectorRow,
  IconButton,
  IconInput,
  Dropdown,
} from '@/components/inspector';
import { expandCommand } from '@/lib/yaml';
import type { Step, StepEdge } from '@/types/pupload';

// =====================================================================
// StepConfigPanel — edits a Step. Inputs/Outputs/Flags are rendered
// from the referenced Task's definitions, so the form auto-adapts to
// whatever tasks the BFF returns.
// =====================================================================

export default function StepConfigPanel({ stepID }: { stepID: string }) {
  const flow = useActiveFlow();
  const tasks = useTasks();
  const actions = useFlowActions();

  const step = flow?.Steps.find((s) => s.ID === stepID);
  const task = useTaskByUses(step?.Uses);

  const allEdges = useMemo(() => {
    if (!flow) return [] as string[];
    const set = new Set<string>();
    flow.Steps.forEach((s) => {
      s.Inputs.forEach((p) => p.Edge && set.add(p.Edge));
      s.Outputs.forEach((p) => p.Edge && set.add(p.Edge));
    });
    flow.DataWells.forEach((w) => set.add(w.Edge));
    return Array.from(set);
  }, [flow]);

  if (!step) {
    return <div className="p-4 text-sm text-ink-faint">Step not found.</div>;
  }

  const updateStepField = (patch: Partial<Step>) => actions.updateStep(step.ID, patch);

  const updatePort = (kind: 'Inputs' | 'Outputs', name: string, edge: string) => {
    const ports = step[kind].map((p) => (p.Name === name ? { ...p, Edge: edge } : p));
    if (!ports.some((p) => p.Name === name)) ports.push({ Name: name, Edge: edge });
    updateStepField({ [kind]: ports } as Partial<Step>);
  };

  const updateFlag = (name: string, value: string) => {
    const flags = step.Flags.map((f) => (f.Name === name ? { ...f, Value: value } : f));
    if (!flags.some((f) => f.Name === name)) flags.push({ Name: name, Value: value });
    updateStepField({ Flags: flags });
  };

  return (
    <div className="flex flex-col">
      <SelectionHeader
        kind="Step"
        primary={step.ID}
        secondary={task ? `${task.Publisher}/${task.Name}` : step.Uses || '— no task —'}
        onDelete={() => actions.deleteStep(step.ID)}
      />

      <InspectorSection title="Identity">
        <InspectorRow label="Step ID">
          <IconInput
            mono
            prefix="#"
            value={step.ID}
            onChange={(e) => updateStepField({ ID: e.target.value })}
          />
        </InspectorRow>
        <InspectorRow label="Task">
          <Dropdown value={step.Uses} onChange={(e) => updateStepField({ Uses: e.target.value })}>
            <option value="">— pick a task —</option>
            {tasks.map((t) => (
              <option key={`${t.Publisher}/${t.Name}`} value={`${t.Publisher}/${t.Name}`}>
                {t.Publisher}/{t.Name}
              </option>
            ))}
          </Dropdown>
        </InspectorRow>
      </InspectorSection>

      <InspectorSection title="Inputs">
        {(task?.Inputs ?? step.Inputs.map((p) => ({ Name: p.Name, Description: '', Required: false, Type: [] }))).map((def) => {
          const bound = step.Inputs.find((p) => p.Name === def.Name);
          return (
            <PortRow
              key={`in-${def.Name}`}
              name={def.Name}
              edge={bound?.Edge ?? ''}
              edges={allEdges}
              onChange={(edge) => updatePort('Inputs', def.Name, edge)}
            />
          );
        })}
      </InspectorSection>

      <InspectorSection title="Outputs">
        {(task?.Outputs ?? step.Outputs.map((p) => ({ Name: p.Name, Description: '', Required: false, Type: [] }))).map((def) => {
          const bound = step.Outputs.find((p) => p.Name === def.Name);
          return (
            <PortRow
              key={`out-${def.Name}`}
              name={def.Name}
              edge={bound?.Edge ?? ''}
              edges={allEdges}
              onChange={(edge) => updatePort('Outputs', def.Name, edge)}
            />
          );
        })}
      </InspectorSection>

      <InspectorSection title="Flags">
        {(task?.Flags ?? []).length === 0 && step.Flags.length === 0 ? (
          <EmptyHint>No flags defined.</EmptyHint>
        ) : null}
        {(task?.Flags ?? []).map((def) => {
          const bound = step.Flags.find((f) => f.Name === def.Name);
          return (
            <InspectorRow key={def.Name} label={def.Name}>
              <IconInput
                mono
                prefix={def.Type?.[0]?.toUpperCase() ?? 'F'}
                value={bound?.Value ?? ''}
                placeholder={def.Default ?? ''}
                onChange={(e) => updateFlag(def.Name, e.target.value)}
              />
            </InspectorRow>
          );
        })}
      </InspectorSection>

      <InspectorSection title="Command Preview" bare>
        <pre className="overflow-auto rounded-row bg-raised p-2 font-mono text-[11px] leading-relaxed text-ink-dim">
          {expandCommand(task, step) || <span className="text-ink-faint">No command available.</span>}
        </pre>
      </InspectorSection>
    </div>
  );
}

/* ----------------------------- helpers ----------------------------- */

function EmptyHint({ children }: { children: React.ReactNode }) {
  return (
    <p className="px-1.5 py-1 text-[10px] font-light leading-none text-ink-faint">
      {children}
    </p>
  );
}

// Header strip for any inspector that's editing a single selection.
// Used by Step / DataWell / Edge sub-panels to keep their headings
// visually identical.
export function SelectionHeader({
  kind,
  primary,
  secondary,
  onDelete,
}: {
  kind: string;
  primary: string;
  secondary?: string;
  onDelete?: () => void;
}) {
  return (
    <div className="flex items-start justify-between gap-2 border-b border-border px-2 py-2">
      <div className="min-w-0">
        <p className="text-[10px] font-light uppercase tracking-[0.08em] text-ink-faint">
          {kind}
        </p>
        <p className="mt-0.5 truncate font-mono text-[12px] leading-tight text-ink">
          {primary}
        </p>
        {secondary ? (
          <p className="mt-0.5 truncate text-[11px] leading-tight text-ink-faint">
            {secondary}
          </p>
        ) : null}
      </div>
      {onDelete ? (
        <IconButton size="sm" aria-label={`Delete ${kind.toLowerCase()}`} onClick={onDelete} icon={<Trash2 size={12} />} />
      ) : null}
    </div>
  );
}

function PortRow({
  name,
  edge,
  edges,
  onChange,
}: {
  name: string;
  edge: string;
  edges: string[];
  onChange: (edge: string) => void;
}) {
  return (
    <InspectorRow label={name}>
      <Dropdown
        value={edges.includes(edge) ? edge : ''}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">— pick edge —</option>
        {edges.map((edgeName) => (
          <option key={edgeName} value={edgeName}>
            {edgeName}
          </option>
        ))}
      </Dropdown>
      <IconInput
        mono
        prefix="E"
        placeholder="new edge"
        value={edge}
        onChange={(e) => onChange(e.target.value)}
      />
    </InspectorRow>
  );
}

// keep tsc happy if this type is referenced elsewhere
export type { StepEdge };
