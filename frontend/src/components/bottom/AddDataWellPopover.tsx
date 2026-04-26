import { useState } from 'react';

import Popover from '@/components/common/Popover';
import Field from '@/components/common/Field';
import TextInput from '@/components/common/TextInput';
import Select from '@/components/common/Select';
import Button from '@/components/common/Button';
import { useActiveFlow, useFlowActions } from '@/state/flowStore';
import type { DataWell, DataWellSource } from '@/types/pupload';

// =====================================================================
// AddDataWellPopover — quick form for creating a new data well.
// =====================================================================

// Mirrors `FlowSettingsPanel::SOURCE_OPTIONS`. The empty-string entry
// represents `Source: undefined` — i.e. nil on the Go side.
const SOURCE_OPTIONS: { value: '' | DataWellSource; label: string }[] = [
  { value: '', label: 'none' },
  { value: 'upload', label: 'upload' },
  { value: 'static', label: 'static' },
  { value: 'webhook', label: 'webhook' },
];

interface AddDataWellPopoverProps {
  open: boolean;
  onClose: () => void;
}

export default function AddDataWellPopover({ open, onClose }: AddDataWellPopoverProps) {
  const flow = useActiveFlow();
  const actions = useFlowActions();
  const [edgeName, setEdgeName] = useState('');
  const [storeName, setStoreName] = useState('');
  // `undefined` here → nil on the wire ("none" in the dropdown). Default
  // to none so the user has to opt in to a specific source kind.
  const [source, setSource] = useState<DataWellSource | undefined>(undefined);
  const [keyTpl, setKeyTpl] = useState('${RUN_ID}/${EDGE}');

  if (!flow) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!edgeName.trim()) return;
    const well: DataWell = {
      Edge: edgeName.trim(),
      Store: storeName,
      // Omit when 'none' so the field round-trips as nil.
      ...(source ? { Source: source } : {}),
      Key: keyTpl || undefined,
    };
    const x = 80;
    const y = 320 + flow.DataWells.length * 70;
    actions.addDataWell(well, { x, y });
    actions.selectElement({ type: 'datawell', id: well.Edge });
    setEdgeName('');
    onClose();
  };

  return (
    <Popover open={open} onClose={onClose} className="w-80">
      <h3 className="text-2xs font-semibold uppercase tracking-[0.12em] text-ink-faint">
        Add Data Well
      </h3>
      <form onSubmit={handleSubmit} className="mt-2 flex flex-col gap-2">
        <Field label="Edge name">
          <TextInput
            autoFocus
            mono
            placeholder="upload"
            value={edgeName}
            onChange={(e) => setEdgeName(e.target.value)}
          />
        </Field>
        <Field label="Store">
          <Select value={storeName} onChange={(e) => setStoreName(e.target.value)}>
            <option value="">— pick store —</option>
            {flow.Stores.map((s) => (
              <option key={s.Name} value={s.Name}>
                {s.Name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Source">
          <Select
            value={source ?? ''}
            onChange={(e) => {
              const v = e.target.value;
              setSource(v === '' ? undefined : (v as DataWellSource));
            }}
          >
            {SOURCE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Key template">
          <TextInput mono value={keyTpl} onChange={(e) => setKeyTpl(e.target.value)} />
        </Field>
        <div className="flex justify-end gap-2 pt-1">
          <Button size="sm" variant="ghost" type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" variant="primary" type="submit">
            Create
          </Button>
        </div>
      </form>
    </Popover>
  );
}
