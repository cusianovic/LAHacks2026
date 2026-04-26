import { useRef, useState, type ReactNode } from 'react';
import clsx from 'clsx';
import {
  Plus,
  Database,
  Sparkles,
  CheckCircle2,
  Play,
  FileCode2,
  Send,
} from 'lucide-react';

import { bff } from '@/lib/bff';
import {
  useActiveFlow,
  useFlowActions,
  useFlowState,
  useFlowValidation,
  useRunState,
  useTasks,
} from '@/state/flowStore';
import type { RunPhase } from '@/state/flowStore';

import AddStepPopover from './AddStepPopover';
import AddDataWellPopover from './AddDataWellPopover';
import AiGenerateModal from './AiGenerateModal';

// =====================================================================
// BottomBar — Figma-style floating pill toolbar.
//
//   ┌─────────────────────────────────────────────────────────────┐
//   │ [ + Step ] [ + Well ] [ ✦ AI ] │ [ {} YAML ] │ [ ✓ ] [ ▶ Run ] [ ↗ Publish ] │
//   └─────────────────────────────────────────────────────────────┘
//
// Anatomy:
//   - One rounded-full container, three logical groups separated
//     by thin vertical dividers.
//   - Each `PillButton` is an icon + optional label.
//   - Group A: creation actions (popovers / modal).
//   - Group B: YAML toggle (with an inline format switcher when open).
//   - Group C: lifecycle (Validate, Run, Publish).
//
// Re-skinning notes:
//   - Outer chrome: `bg-chrome` + `border-border` + `shadow-pill`.
//     The pill matches the Figma frame exactly (rounded-pill, 1px
//     border, dark fill).
//   - Variants live in `PillButton` below; add new ones for new states
//     (e.g. "danger", "warning").
//
// Run UX:
//   1. Click Run → dispatch RUN_START + call `bff.testFlow`.
//   2. The initial `FlowRun` is dispatched as a snapshot; the store's
//      `useRunPoller` then takes over and drives further snapshots.
//   3. Datawells with `Source="upload"` paint themselves as clickable
//      — the per-edge file picker lives in `DataWellNode`, not here.
//   4. The button label below mirrors `runState.phase` so the operator
//      can tell the run is alive without watching the canvas.
// =====================================================================

export default function BottomBar() {
  const { yamlPanel, projectID, project, layouts, publishStatus } = useFlowState();
  const flow = useActiveFlow();
  const tasks = useTasks();
  const actions = useFlowActions();
  const validation = useFlowValidation();
  const runState = useRunState();

  const [stepOpen, setStepOpen] = useState(false);
  const [wellOpen, setWellOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);

  // Wrapper refs are passed to each popover as `anchorRef` so clicks on
  // the trigger button bypass the popover's outside-click dismissal.
  // Without this, re-clicking a trigger would race the dismissal vs the
  // toggle and leave the popover stuck open. See `Popover.tsx` header.
  const stepWrapRef = useRef<HTMLDivElement>(null);
  const wellWrapRef = useRef<HTMLDivElement>(null);

  const [publishBusy, setPublishBusy] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);

  // Validation runs continuously via `useFlowValidation()`, so the
  // button just opens the Issues tab. (Toggling it off if it's already
  // showing matches the YAML/JSON pill behaviour.)
  const handleValidate = () => {
    actions.toggleYaml('issues');
  };

  // Kick off a run. The actual polling loop lives in the store
  // (`useRunPoller`) — it spins up automatically once `runID` is
  // committed via the initial snapshot dispatched here. Uploads
  // happen on demand from `DataWellNode`, not from a popup.
  const handleRun = async () => {
    if (!flow) return;
    actions.runStart(flow.Name);
    try {
      const initial = await bff.testFlow(flow, tasks);
      actions.runSnapshot(initial);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      actions.runFailed(message);
      console.warn('[run] testFlow failed', err);
    }
  };

  const handlePublish = async () => {
    setPublishBusy(true);
    setPublishError(null);
    try {
      // The autosave is debounced (600ms), so the BFF may still be
      // holding a stale draft when the user clicks Publish. Flush
      // synchronously first so the controller gets exactly what is
      // currently on the canvas.
      await bff.saveDraft(projectID, project, layouts, publishStatus);
      await bff.publish(projectID);
      actions.setPublishStatus('published');
      console.log('[publish] success');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setPublishError(message);
      console.warn('[publish] failed', err);
    } finally {
      setPublishBusy(false);
    }
  };

  const runLabel = describeRunPhase(runState.phase, runState.uploads);
  const runActive = isRunActive(runState.phase);
  const errorCount = validation.Errors.length;
  const warnCount = validation.Warnings.length;
  const hasErrors = errorCount > 0;
  const validateLabel =
    errorCount > 0
      ? `${errorCount} ${errorCount === 1 ? 'issue' : 'issues'}`
      : warnCount > 0
        ? `${warnCount} ${warnCount === 1 ? 'warning' : 'warnings'}`
        : 'Valid';
  const validateVariant: 'ghost' | 'danger' | 'warn' =
    errorCount > 0 ? 'danger' : warnCount > 0 ? 'warn' : 'ghost';

  // Run / Publish are gated on a clean validation result. The label
  // also reflects the current publish status / last error so the user
  // gets feedback without opening devtools.
  const publishLabel = publishBusy
    ? 'Publishing…'
    : publishError
      ? 'Publish failed'
      : publishStatus === 'published'
        ? 'Published'
        : 'Publish';
  const publishVariant: 'ghost' | 'danger' = publishError ? 'danger' : 'ghost';
  const runVariant: 'primary' | 'danger' | 'warn' =
    runState.phase === 'error'
      ? 'danger'
      : runState.phase === 'awaiting_uploads'
        ? 'warn'
        : 'primary';

  return (
    <>
      <div
        className={clsx(
          // Match the Figma pill exactly: dark fill, hairline border,
          // generous corner radius. Drop shadow lifts it off the
          // light canvas.
          'pointer-events-auto inline-flex items-center gap-0.5 rounded-pill p-1',
          'border border-border bg-chrome shadow-pill',
        )}
      >
        {/* ── Group A: creation actions ─────────────────────── */}
        <div ref={stepWrapRef} className="relative">
          <PillButton
            icon={<Plus size={13} />}
            label="Step"
            onClick={() => {
              setStepOpen((v) => !v);
              setWellOpen(false);
            }}
            active={stepOpen}
          />
          <AddStepPopover
            open={stepOpen}
            onClose={() => setStepOpen(false)}
            anchorRef={stepWrapRef}
          />
        </div>
        <div ref={wellWrapRef} className="relative">
          <PillButton
            icon={<Database size={13} />}
            label="Data Well"
            onClick={() => {
              setWellOpen((v) => !v);
              setStepOpen(false);
            }}
            active={wellOpen}
          />
          <AddDataWellPopover
            open={wellOpen}
            onClose={() => setWellOpen(false)}
            anchorRef={wellWrapRef}
          />
        </div>
        <PillButton
          icon={<Sparkles size={13} />}
          label="AI"
          onClick={() => setAiOpen(true)}
          variant="brand"
        />

        <Divider />

        {/* ── Group B: YAML toggle ──────────────────────────── */}
        <PillButton
          icon={<FileCode2 size={13} />}
          label={yamlPanel.format.toUpperCase()}
          onClick={() => actions.toggleYaml(yamlPanel.format)}
          active={yamlPanel.open}
        />

        <Divider />

        {/* ── Group C: lifecycle ────────────────────────────── */}
        <PillButton
          icon={<CheckCircle2 size={13} />}
          label={validateLabel}
          onClick={handleValidate}
          disabled={!flow}
          variant={validateVariant}
          active={yamlPanel.open && yamlPanel.format === 'issues'}
        />
        <PillButton
          icon={<Play size={13} />}
          label={runLabel}
          onClick={handleRun}
          disabled={runActive || !flow || hasErrors}
          title={
            hasErrors
              ? 'Resolve validation errors before running'
              : runState.phase === 'awaiting_uploads'
                ? 'Click an upload datawell on the canvas to provide its file'
                : runState.errorMessage ?? undefined
          }
          variant={runVariant}
        />
        <PillButton
          icon={<Send size={13} />}
          label={publishLabel}
          onClick={handlePublish}
          disabled={publishBusy || !flow || hasErrors}
          title={hasErrors ? 'Resolve validation errors before publishing' : publishError ?? undefined}
          variant={publishVariant}
        />
      </div>

      <AiGenerateModal open={aiOpen} onClose={() => setAiOpen(false)} />
    </>
  );
}

/* --------------------------- sub-components ------------------------- */

interface PillButtonProps {
  icon: ReactNode;
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  active?: boolean;
  /** Native `title` attribute — shown as a tooltip on hover. */
  title?: string;
  variant?: 'ghost' | 'brand' | 'primary' | 'danger' | 'warn';
}

/**
 * PillButton — single segment of the floating toolbar.
 *
 * Variants:
 *   - `ghost`   (default): low-emphasis transparent, white-on-hover.
 *   - `brand`           : Pupload accent — used for AI.
 *   - `primary`         : solid brand fill — the strongest CTA (Run).
 *   - `danger`          : red tint — used by Validate when errors exist.
 *   - `warn`            : amber tint — used by Validate for warning-only state.
 */
function PillButton({
  icon,
  label,
  onClick,
  disabled,
  active,
  title,
  variant = 'ghost',
}: PillButtonProps) {
  const base = 'inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 text-[12px] font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed';
  const variants: Record<NonNullable<PillButtonProps['variant']>, string> = {
    ghost: clsx(
      'text-ink-dim hover:bg-raised hover:text-ink',
      active && 'bg-raised text-ink',
    ),
    brand: clsx(
      'text-ink hover:bg-raised',
      active && 'bg-raised',
    ),
    primary: clsx(
      'bg-accent text-ink hover:bg-accent-dim',
      active && 'bg-accent-dim',
    ),
    danger: clsx(
      'text-status-error hover:bg-raised',
      active && 'bg-raised',
    ),
    warn: clsx(
      'text-status-warn hover:bg-raised',
      active && 'bg-raised',
    ),
  };
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={clsx(base, variants[variant])}
    >
      <span className="shrink-0">{icon}</span>
      <span className="whitespace-nowrap">{label}</span>
    </button>
  );
}

function Divider() {
  return <span className="mx-1 h-4 w-px bg-edge" aria-hidden />;
}

// describeRunPhase produces the Run-button label from the store's
// runState. The `awaiting_uploads` label includes a quick count so the
// operator knows how many files are still needed.
function describeRunPhase(
  phase: RunPhase,
  uploads: Record<string, { state: string }>,
): string {
  switch (phase) {
    case 'idle':
      return 'Run';
    case 'starting':
      return 'Starting…';
    case 'awaiting_uploads': {
      const remaining = Object.values(uploads).filter(
        (u) => u.state !== 'uploaded',
      ).length;
      if (remaining === 0) return 'Waiting…';
      return `Awaiting ${remaining} upload${remaining === 1 ? '' : 's'}…`;
    }
    case 'running':
      return 'Running…';
    case 'complete':
      return 'Complete';
    case 'error':
      return 'Error';
  }
}

function isRunActive(phase: RunPhase): boolean {
  return phase === 'starting' || phase === 'awaiting_uploads' || phase === 'running';
}
