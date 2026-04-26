import { memo } from 'react';
import { Handle, Position, type NodeProps } from 'reactflow';
import clsx from 'clsx';

import type { Step, StepRunStatus, Task, TaskEdgeDef } from '@/types/pupload';

// =====================================================================
// StepNode — custom React Flow node for a Pupload Step.
//
// Data shape passed in via the `data` prop:
//   { step, task?, status }
//
// Visual:
//   ┌──────────────────────────────────────┐
//   │ ▌ status strip                       │
//   │ Task Name              [c-small]     │
//   │ pupload/ffmpeg                       │
//   ├──────────────────────────────────────┤
//   │ ●in1                          out1●  │
//   │ ●in2                          out2●  │
//   └──────────────────────────────────────┘
//
// Handle positioning: each port row is `PORT_ROW_HEIGHT` tall. The
// React Flow `<Handle>` is absolutely positioned by RF; we offset its
// `top` so it lines up with the row label.
// =====================================================================

export interface StepNodeData {
  step: Step;
  task?: Task;
  status: StepRunStatus;
}

const NODE_WIDTH = 220;
const HEADER_HEIGHT = 64;
const PORT_ROW_HEIGHT = 22;

const STATUS_COLOR: Record<StepRunStatus, string> = {
  IDLE: 'bg-status-idle',
  READY: 'bg-status-ready',
  RUNNING: 'bg-status-running',
  RETRYING: 'bg-status-waiting',
  COMPLETE: 'bg-status-complete',
  ERROR: 'bg-status-error',
};

// Mark `Required` ports with a tiny accent indicator. Kept simple to
// match the spare aesthetic.
const PORT_REQUIRED_DOT = 'text-accent';

function inferPorts(stepPorts: { Name: string }[]): TaskEdgeDef[] {
  return stepPorts.map((p) => ({ Name: p.Name, Description: '', Required: false, Type: [] }));
}

function StepNode({ data, selected }: NodeProps<StepNodeData>) {
  const { step, task, status } = data;
  const inputs = task?.Inputs ?? inferPorts(step.Inputs);
  const outputs = task?.Outputs ?? inferPorts(step.Outputs);
  const taskTitle = task?.Name ?? step.Uses.split('/').pop() ?? 'untitled';
  const publisher = task ? `${task.Publisher}/${task.Name}` : step.Uses || '—';
  const portRows = Math.max(inputs.length, outputs.length, 1);
  const totalHeight = HEADER_HEIGHT + portRows * PORT_ROW_HEIGHT + 12;

  return (
    <div
      className={clsx(
        // Dark node sitting on the LIGHT canvas. The 1px border is the
        // same `--color-border` as everywhere else in the chrome, and a
        // subtle drop-shadow gives it a hint of lift on the paper-grey
        // canvas without going full skeuomorphic.
        'relative overflow-hidden rounded-row border bg-chrome shadow-pill transition-shadow',
        selected
          ? 'border-accent ring-1 ring-accent'
          : 'border-border hover:border-ink-faint',
      )}
      style={{ width: NODE_WIDTH, height: totalHeight }}
    >
      {/* status strip */}
      <div className={clsx('h-1 w-full', STATUS_COLOR[status])} />

      {/* body */}
      <div className="px-3 pt-2 pb-2">
        <div className="flex items-start justify-between gap-2">
          <h3 className="truncate text-[13px] font-semibold leading-tight text-ink">
            {taskTitle}
          </h3>
          {task ? (
            <span className="shrink-0 rounded-row bg-raised px-1.5 py-0.5 font-mono text-[10px] leading-none text-ink-dim">
              {task.Tier}
            </span>
          ) : null}
        </div>
        <p className="mt-0.5 truncate font-mono text-[11px] text-ink-faint">{publisher}</p>
      </div>

      {/* ports */}
      {inputs.map((p, i) => (
        <PortRow
          key={`in-${p.Name}`}
          name={p.Name}
          side="left"
          required={p.Required}
          top={HEADER_HEIGHT + i * PORT_ROW_HEIGHT}
        />
      ))}
      {outputs.map((p, i) => (
        <PortRow
          key={`out-${p.Name}`}
          name={p.Name}
          side="right"
          required={p.Required}
          top={HEADER_HEIGHT + i * PORT_ROW_HEIGHT}
        />
      ))}
    </div>
  );
}

function PortRow({
  name,
  side,
  required,
  top,
}: {
  name: string;
  side: 'left' | 'right';
  required?: boolean;
  top: number;
}) {
  return (
    <>
      <Handle
        id={name}
        type={side === 'left' ? 'target' : 'source'}
        position={side === 'left' ? Position.Left : Position.Right}
        style={{ top, background: undefined }}
      />
      <span
        className={clsx(
          'absolute select-none font-mono text-[10px] leading-none text-ink-dim',
          side === 'left' ? 'left-3' : 'right-3 text-right',
        )}
        style={{ top: top - 5 }}
      >
        {name}
        {required ? <span className={clsx('ml-0.5', PORT_REQUIRED_DOT)}>*</span> : null}
      </span>
    </>
  );
}

export default memo(StepNode);
