import { useActiveFlow, useFlowActions } from '@/state/flowStore';
import {
  InspectorSection,
  InspectorRow,
  IconInput,
  Dropdown,
} from '@/components/inspector';
import { SelectionHeader } from './StepConfigPanel';
import type { DataWellSource } from '@/types/pupload';

// =====================================================================
// DataWellPanel — edits one data well in the active flow.
// Available variables for the key template are listed at the bottom.
// =====================================================================

// Mirrors `FlowSettingsPanel::SOURCE_OPTIONS`. The empty-string entry
// represents `Source: undefined` — i.e. nil on the Go side.
const SOURCE_OPTIONS: { value: '' | DataWellSource; label: string }[] = [
  { value: '', label: 'none' },
  { value: 'upload', label: 'upload' },
  { value: 'static', label: 'static' },
  { value: 'webhook', label: 'webhook' },
];
const KEY_VARS = ['${RUN_ID}', '${FLOW_NAME}', '${EDGE}', '${TIMESTAMP}', '${DATE}', '${UUID}'];

export default function DataWellPanel({ edge }: { edge: string }) {
  const flow = useActiveFlow();
  const actions = useFlowActions();
  const well = flow?.DataWells.find((w) => w.Edge === edge);

  if (!flow || !well) {
    return <div className="p-4 text-sm text-ink-faint">Data well not found.</div>;
  }

  return (
    <div className="flex flex-col">
      <SelectionHeader
        kind="Data Well"
        primary={well.Edge}
        onDelete={() => actions.deleteDataWell(well.Edge)}
      />

      <InspectorSection title="Binding">
        <InspectorRow label="Edge name">
          <IconInput
            mono
            prefix="E"
            value={well.Edge}
            onChange={(e) => actions.updateDataWell(well.Edge, { Edge: e.target.value })}
          />
        </InspectorRow>
        <InspectorRow label="Store">
          <Dropdown
            value={well.Store}
            onChange={(e) => actions.updateDataWell(well.Edge, { Store: e.target.value })}
          >
            <option value="">— pick store —</option>
            {flow.Stores.map((s) => (
              <option key={s.Name} value={s.Name}>
                {s.Name}
              </option>
            ))}
          </Dropdown>
        </InspectorRow>
        <InspectorRow label="Source">
          <Dropdown
            value={well.Source ?? ''}
            onChange={(e) => {
              const v = e.target.value;
              actions.updateDataWell(well.Edge, {
                Source: v === '' ? undefined : (v as DataWellSource),
              });
            }}
          >
            {SOURCE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </Dropdown>
        </InspectorRow>
      </InspectorSection>

      <InspectorSection title="Key Template">
        <IconInput
          mono
          prefix="K"
          placeholder="${RUN_ID}/${EDGE}"
          value={well.Key ?? ''}
          onChange={(e) => actions.updateDataWell(well.Edge, { Key: e.target.value })}
        />
        <div className="flex flex-wrap gap-1">
          {KEY_VARS.map((v) => (
            <button
              key={v}
              type="button"
              onClick={() =>
                actions.updateDataWell(well.Edge, { Key: `${well.Key ?? ''}${v}` })
              }
              className="rounded-row bg-raised px-1.5 py-0.5 font-mono text-[10px] leading-none text-ink-dim hover:bg-raised-hover hover:text-ink"
            >
              {v}
            </button>
          ))}
        </div>
      </InspectorSection>

      <InspectorSection title="Lifetime" bare>
        {/* TODO(wire): expose lifetime fields once Go DataWellLifetime is finalized. */}
        <p className="px-1.5 py-1 text-[10px] font-light leading-none text-ink-faint">
          Lifetime configuration coming soon.
        </p>
      </InspectorSection>
    </div>
  );
}
