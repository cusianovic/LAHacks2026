import { memo } from 'react';
import { Handle, Position, type NodeProps } from 'reactflow';
import clsx from 'clsx';
import { Loader2, Check, AlertTriangle, Clock } from 'lucide-react';

import type { Step, StepRunStatus, Task, TaskEdgeDef } from '@/types/pupload';

// =====================================================================
// StepNode — custom React Flow node for a Pupload Step.
//
// Data shape passed in via the `data` prop:
//   { step, task?, status }
//
// Visual:
//   ┌──────────────────────────────────────┐
//   │ ▌ status strip                       │   ← animates per RUNNING state
//   │ Task Name              [badge]       │   ← badge shows status during run, tier otherwise
//   │ pupload/ffmpeg                       │
//   ├───────────────────────────────────────┤
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

// Mark `Required` ports with a tiny accent indicator. Kept simple to
// match the spare aesthetic.
const PORT_REQUIRED_DOT = 'text-accent';

// Dedupe by `Name` when falling back to the step's own port list.
// Both Inputs and Outputs are 1:1 with their port name under the
// current binding helpers (fan-out happens by sharing edge names
// across inputs, not by duplicating output entries), so this is
// defensive against legacy YAML carrying duplicate entries.
function inferPorts(stepPorts: { Name: string }[]): TaskEdgeDef[] {
  const seen = new Set<string>();
  const out: TaskEdgeDef[] = [];
  for (const p of stepPorts) {
    if (seen.has(p.Name)) continue;
    seen.add(p.Name);
    out.push({ Name: p.Name, Description: '', Required: false, Type: [] });
  }
  return out;
}

// StatusStrip is the thin coloured bar across the top of the node.
// IDLE/READY/COMPLETE/ERROR are flat fills; RUNNING uses a marching
// diagonal stripe that animates left→right; RETRYING fades in/out.
// Background gradients are inline (vs Tailwind classes) because
// `linear-gradient` needs a literal value and we want to reference the
// CSS variables for the status colours.
function StatusStrip({ status }: { status: StepRunStatus }) {
  const baseClass = 'h-1 w-full';
  switch (status) {
    case 'RUNNING':
      return (
        <div
          className={clsx(baseClass, 'animate-marching-stripes')}
          style={{
            backgroundImage:
              'repeating-linear-gradient(45deg, var(--color-status-running) 0 6px, color-mix(in srgb, var(--color-status-running) 55%, transparent) 6px 12px)',
            backgroundSize: '24px 100%',
          }}
        />
      );
    case 'RETRYING':
      return <div className={clsx(baseClass, 'animate-pulse bg-status-waiting')} />;
    case 'READY':
      return <div className={clsx(baseClass, 'animate-pulse bg-status-ready')} />;
    case 'COMPLETE':
      return <div className={clsx(baseClass, 'bg-status-complete')} />;
    case 'ERROR':
      return <div className={clsx(baseClass, 'bg-status-error')} />;
    case 'IDLE':
    default:
      return <div className={clsx(baseClass, 'bg-status-idle/60')} />;
  }
}

// StatusBadge is the small label that occupies the tier-badge slot
// during a run. Each variant uses the matching status color so a
// glance across the canvas tells you which steps are active.
function StatusBadge({ status }: { status: StepRunStatus }) {
  const cfg = BADGE_CFG[status];
  if (!cfg) return null;
  const Icon = cfg.icon;
  return (
    <span
      className={clsx(
        'inline-flex shrink-0 items-center gap-1 rounded-row px-1.5 py-0.5 font-mono text-[10px] leading-none',
        cfg.tone,
      )}
    >
      {Icon ? <Icon size={10} className={cfg.iconClass} /> : null}
      {cfg.label}
    </span>
  );
}

const BADGE_CFG: Partial<
  Record<
    StepRunStatus,
    {
      label: string;
      tone: string;
      icon?: typeof Clock;
      iconClass?: string;
    }
  >
> = {
  READY: {
    label: 'queued',
    tone: 'bg-status-ready/15 text-status-ready',
    icon: Clock,
  },
  RUNNING: {
    label: 'running',
    tone: 'bg-status-running/15 text-status-running',
    icon: Loader2,
    iconClass: 'animate-spin',
  },
  RETRYING: {
    label: 'retrying',
    tone: 'bg-status-waiting/15 text-status-waiting',
    icon: Loader2,
    iconClass: 'animate-spin',
  },
  COMPLETE: {
    label: 'done',
    tone: 'bg-status-complete/15 text-status-complete',
    icon: Check,
  },
  ERROR: {
    label: 'error',
    tone: 'bg-status-error/15 text-status-error',
    icon: AlertTriangle,
  },
};

function StepNode({ data, selected }: NodeProps<StepNodeData>) {
  const { step, task, status } = data;
  const inputs = task?.Inputs ?? inferPorts(step.Inputs);
  const outputs = task?.Outputs ?? inferPorts(step.Outputs);
  const taskTitle = task?.Name ?? step.Uses.split('/').pop() ?? 'untitled';
  const publisher = task ? `${task.Publisher}/${task.Name}` : step.Uses || '—';
  const portRows = Math.max(inputs.length, outputs.length, 1);
  const totalHeight = HEADER_HEIGHT + portRows * PORT_ROW_HEIGHT + 12;
  const isRunning = status === 'RUNNING' || status === 'RETRYING';
  const isTerminal = status === 'COMPLETE' || status === 'ERROR';

  return (
    <div
      className={clsx(
        // Dark node sitting on the LIGHT canvas. The 1px border is the
        // same `--color-border` as everywhere else in the chrome, and a
        // subtle drop-shadow gives it a hint of lift on the paper-grey
        // canvas without going full skeuomorphic.
        'relative overflow-hidden rounded-row border bg-chrome shadow-pill transition-all',
        // Selection ring takes precedence; otherwise running/error
        // states get a subtle border tint so the node stands out
        // even when the status strip is occluded.
        selected
          ? 'border-accent ring-1 ring-accent'
          : status === 'RUNNING'
            ? 'border-status-running/60'
            : status === 'COMPLETE'
              ? 'border-status-complete/50'
              : status === 'ERROR'
                ? 'border-status-error/60'
                : 'border-border hover:border-ink-faint',
      )}
      style={{ width: NODE_WIDTH, height: totalHeight }}
    >
      {/* status strip — thin top bar that visualises the run phase */}
      <StatusStrip status={status} />

      {/* body */}
      <div className="px-3 pt-2 pb-2">
        <div className="flex items-start justify-between gap-2">
          <h3 className="truncate text-[13px] font-semibold leading-tight text-ink">
            {taskTitle}
          </h3>
          {/* During a run the status badge replaces the tier label so
             the user gets a quick text readout per node. */}
          {isRunning || isTerminal || status === 'READY' ? (
            <StatusBadge status={status} />
          ) : task ? (
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
