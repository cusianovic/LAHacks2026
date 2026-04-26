import { useMemo, useState } from 'react';

import Popover from '@/components/common/Popover';
import TextInput from '@/components/common/TextInput';
import Pill from '@/components/common/Pill';
import { useActiveFlow, useFlowActions, useTasks } from '@/state/flowStore';
import type { Step, Task } from '@/types/pupload';

// =====================================================================
// AddStepPopover — task picker for the "Add Step" button.
// New step is placed at a slightly randomized offset near the canvas
// center; ReactFlow's auto-fit will adjust the view if necessary.
// =====================================================================

interface AddStepPopoverProps {
  open: boolean;
  onClose: () => void;
}

export default function AddStepPopover({ open, onClose }: AddStepPopoverProps) {
  const tasks = useTasks();
  const flow = useActiveFlow();
  const actions = useFlowActions();
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return tasks;
    return tasks.filter(
      (t) =>
        t.Name.toLowerCase().includes(q) ||
        t.Publisher.toLowerCase().includes(q) ||
        t.Tier.toLowerCase().includes(q),
    );
  }, [tasks, query]);

  const handlePick = (task: Task) => {
    if (!flow) return;
    const id = nextStepID(flow.Steps, task.Name);
    const step: Step = {
      ID: id,
      Uses: `${task.Publisher}/${task.Name}`,
      Inputs: task.Inputs.map((i) => ({ Name: i.Name, Edge: '' })),
      Outputs: task.Outputs.map((o) => ({ Name: o.Name, Edge: '' })),
      Flags: task.Flags
        .filter((f) => f.Required || f.Default)
        .map((f) => ({ Name: f.Name, Value: f.Default ?? '' })),
      Command: task.Command.Name,
    };
    // Drop near the canvas center (we don't have the viewport here; fallback offset).
    const x = 200 + (flow.Steps.length % 4) * 60;
    const y = 160 + Math.floor(flow.Steps.length / 4) * 60;
    actions.addStep(step, { x, y });
    actions.selectElement({ type: 'step', id });
    onClose();
  };

  return (
    <Popover open={open} onClose={onClose} className="w-80">
      <h3 className="text-2xs font-semibold uppercase tracking-[0.12em] text-ink-faint">Add Step</h3>
      <TextInput
        autoFocus
        className="mt-2"
        placeholder="Search tasks…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <div className="mt-2 max-h-72 overflow-y-auto">
        {filtered.length === 0 ? (
          <p className="px-1 py-2 text-2xs text-ink-faint">
            No matching tasks.
            {/* TODO(wire): "Add Task" entry point — opens YAML upload / form. */}
          </p>
        ) : (
          <ul className="flex flex-col gap-0.5">
            {filtered.map((t) => (
              <li key={`${t.Publisher}/${t.Name}`}>
                <button
                  type="button"
                  onClick={() => handlePick(t)}
                  className="flex w-full flex-col gap-0.5 rounded-row px-2 py-1.5 text-left hover:bg-raised"
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="text-sm text-ink">{t.Name}</span>
                    <Pill tone="neutral">{t.Tier}</Pill>
                  </span>
                  <span className="font-mono text-[11px] text-ink-faint">
                    {t.Publisher}/{t.Name}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Popover>
  );
}

function nextStepID(existing: Step[], base: string): string {
  const safe = base.replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase();
  let i = 1;
  let id = `${safe}_${i}`;
  while (existing.some((s) => s.ID === id)) {
    i += 1;
    id = `${safe}_${i}`;
  }
  return id;
}
