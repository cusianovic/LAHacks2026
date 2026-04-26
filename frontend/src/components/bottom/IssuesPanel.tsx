import { useMemo } from 'react';
import clsx from 'clsx';
import { AlertTriangle, AlertCircle, CheckCircle2 } from 'lucide-react';

import { useFlowActions, useFlowValidation } from '@/state/flowStore';
import type { ValidationEntry } from '@/types/pupload';

// =====================================================================
// IssuesPanel — the Issues tab body for the slide-up panel.
// Reads the latest validation result from `useFlowValidation()`,
// which the store debounces and fetches from the controller. Errors
// above warnings; each row is a clickable target so future versions
// can jump to the offending node.
// =====================================================================

export default function IssuesPanel() {
  const { Errors, Warnings } = useFlowValidation();
  const actions = useFlowActions();

  const rows = useMemo<ValidationEntry[]>(
    () => [...Errors, ...Warnings],
    [Errors, Warnings],
  );

  if (rows.length === 0) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center">
        <div className="flex flex-col items-center gap-2 text-ink-faint">
          <CheckCircle2 size={20} className="text-status-saved" />
          <p className="text-xs">No issues found.</p>
          <p className="text-2xs">Validation runs against the controller as you edit.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto">
      <ul className="divide-y divide-border">
        {rows.map((entry, i) => (
          <IssueRow
            key={`${entry.Code}-${i}`}
            entry={entry}
            onClick={() => focusEntry(entry, actions)}
          />
        ))}
      </ul>
    </div>
  );
}

interface IssueRowProps {
  entry: ValidationEntry;
  onClick: () => void;
}

function IssueRow({ entry, onClick }: IssueRowProps) {
  const isError = entry.Type === 'ValidationError';
  const Icon = isError ? AlertCircle : AlertTriangle;
  const tone = isError ? 'text-status-error' : 'text-status-warn';

  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className="flex w-full items-start gap-3 px-3 py-2 text-left transition-colors hover:bg-raised"
      >
        <Icon size={14} className={clsx('mt-0.5 shrink-0', tone)} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-mono text-2xs uppercase tracking-[0.08em] text-ink-faint">
              {entry.Code}
            </span>
            <span className="truncate text-xs font-medium text-ink">{entry.Name}</span>
          </div>
          <p className="mt-0.5 text-2xs leading-relaxed text-ink-dim">{entry.Description}</p>
          {(entry.StepID || entry.Edge || entry.Store || entry.Field) ? (
            <div className="mt-1 flex flex-wrap gap-1">
              {entry.StepID ? <Tag label="step" value={entry.StepID} /> : null}
              {entry.Edge ? <Tag label="edge" value={entry.Edge} /> : null}
              {entry.Store ? <Tag label="store" value={entry.Store} /> : null}
              {entry.Field ? <Tag label="field" value={entry.Field} /> : null}
            </div>
          ) : null}
        </div>
      </button>
    </li>
  );
}

function Tag({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-row border border-border bg-chrome px-1.5 py-0.5 font-mono text-[10px] text-ink-dim">
      <span className="text-ink-faint">{label}</span>
      <span className="text-ink">{value}</span>
    </span>
  );
}

// Best-effort: select the offending element on the canvas so the
// inspector panels surface the field that needs fixing. Stores aren't
// canvas-selectable, so we skip them for now — clicking a store-scoped
// issue is a no-op until the right panel grows a "go to store" affordance.
function focusEntry(
  entry: ValidationEntry,
  actions: ReturnType<typeof useFlowActions>,
): void {
  if (entry.StepID) {
    actions.selectElement({ type: 'step', id: entry.StepID });
    return;
  }
  if (entry.Edge) {
    actions.selectElement({ type: 'edge', id: entry.Edge });
  }
}
