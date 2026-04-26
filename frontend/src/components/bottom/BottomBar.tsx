import { useState, type ReactNode } from 'react';
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

import { bff, DEFAULT_PROJECT_ID } from '@/lib/bff';
import { useActiveFlow, useFlowActions, useFlowState, useTasks } from '@/state/flowStore';

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
// TODO(wire) hooks (action behavior, not visuals):
//   - handleValidate → decorate canvas with errors/warnings.
//   - handleRun      → poll `bff.getRunStatus` and drive node status.
//   - handlePublish  → refresh publishStatus on success.
// =====================================================================

export default function BottomBar() {
  const { yamlPanel } = useFlowState();
  const flow = useActiveFlow();
  const tasks = useTasks();
  const actions = useFlowActions();

  const [stepOpen, setStepOpen] = useState(false);
  const [wellOpen, setWellOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);

  const [busy, setBusy] = useState<string | null>(null);

  const handleValidate = async () => {
    if (!flow) return;
    setBusy('validate');
    try {
      const result = await bff.validate(flow, tasks);
      console.log('[validate] result', result);
    } catch (err) {
      console.warn('[validate] failed', err);
    } finally {
      setBusy(null);
    }
  };

  const handleRun = async () => {
    if (!flow) return;
    setBusy('run');
    try {
      const run = await bff.testFlow(flow, tasks);
      console.log('[run] flow run', run);
    } catch (err) {
      console.warn('[run] failed', err);
    } finally {
      setBusy(null);
    }
  };

  const handlePublish = async () => {
    setBusy('publish');
    try {
      await bff.publish(DEFAULT_PROJECT_ID);
      console.log('[publish] success');
    } catch (err) {
      console.warn('[publish] failed', err);
    } finally {
      setBusy(null);
    }
  };

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
        <div className="relative">
          <PillButton
            icon={<Plus size={13} />}
            label="Step"
            onClick={() => {
              setStepOpen((v) => !v);
              setWellOpen(false);
            }}
            active={stepOpen}
          />
          <AddStepPopover open={stepOpen} onClose={() => setStepOpen(false)} />
        </div>
        <div className="relative">
          <PillButton
            icon={<Database size={13} />}
            label="Data Well"
            onClick={() => {
              setWellOpen((v) => !v);
              setStepOpen(false);
            }}
            active={wellOpen}
          />
          <AddDataWellPopover open={wellOpen} onClose={() => setWellOpen(false)} />
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
          label={busy === 'validate' ? 'Validating…' : 'Validate'}
          onClick={handleValidate}
          disabled={busy === 'validate' || !flow}
        />
        <PillButton
          icon={<Play size={13} />}
          label={busy === 'run' ? 'Running…' : 'Run'}
          onClick={handleRun}
          disabled={busy === 'run' || !flow}
          variant="primary"
        />
        <PillButton
          icon={<Send size={13} />}
          label={busy === 'publish' ? 'Publishing…' : 'Publish'}
          onClick={handlePublish}
          disabled={busy === 'publish'}
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
  variant?: 'ghost' | 'brand' | 'primary';
}

/**
 * PillButton — single segment of the floating toolbar.
 *
 * Variants:
 *   - `ghost`   (default): low-emphasis transparent, white-on-hover.
 *   - `brand`           : Pupload accent — used for AI / Run.
 *   - `primary`         : solid brand fill — the strongest CTA.
 */
function PillButton({
  icon,
  label,
  onClick,
  disabled,
  active,
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
  };
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
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
