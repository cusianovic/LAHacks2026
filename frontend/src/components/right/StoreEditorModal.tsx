import { useEffect, useMemo, useState } from 'react';
import { Eye, EyeOff, ShieldAlert } from 'lucide-react';

import Modal from '@/components/common/Modal';
import Button from '@/components/common/Button';
import {
  InspectorRow,
  IconInput,
  Dropdown,
  Checkbox,
} from '@/components/inspector';
import {
  STORE_TYPES,
  DEFAULT_STORE_TYPE,
  type StoreField,
  type StoreFieldKind,
} from '@/lib/storeSchema';
import type { StoreInput } from '@/types/pupload';

// =====================================================================
// StoreEditorModal — collect (or edit) the fields for one store.
//
// Stores are intentionally generic on the BFF side:
//
//   StoreInput { Name, Type, Params: map[string]any }
//
// The shape of `Params` depends on `Type`. We keep that mapping in
// the `STORE_TYPES` table below — adding a new type is a one-block
// change there. The modal renders the matching fields automatically.
//
// Behaviour:
//   - `initial` is `null`     → "Add" mode; submitting appends.
//   - `initial` is a Store    → "Edit" mode; submitting replaces the
//                               store with the same Name.
//   - `existingNames` is the list of store names ALREADY used in the
//                               flow (excluding the one being edited)
//                               so we can reject duplicates.
// =====================================================================

// Schema lives in `@/lib/storeSchema` so it can be shared with the
// YAML preview redactor without a backwards components→lib import.

interface StoreEditorModalProps {
  open: boolean;
  onClose: () => void;
  /** Existing store to edit, or `null` for an Add operation. */
  initial: StoreInput | null;
  /** Other store names already present in the flow (used for uniqueness). */
  existingNames: string[];
  onSubmit: (store: StoreInput) => void;
}

export default function StoreEditorModal({
  open,
  onClose,
  initial,
  existingNames,
  onSubmit,
}: StoreEditorModalProps) {
  const isEdit = initial !== null;

  // Local form state. Keyed by `Name`/`Type`/<param key>. Reset on
  // every open so we don't leak stale data between invocations.
  const [name, setName] = useState('');
  const [type, setType] = useState<string>(DEFAULT_STORE_TYPE);
  // We keep all values as strings in form state; booleans are stored
  // as 'true'/'false' and converted on submit. Keeps the input plumbing
  // uniform.
  const [params, setParams] = useState<Record<string, string>>({});
  // Per-field reveal state for `secret` fields. Keyed by field.key.
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    if (initial) {
      setName(initial.Name);
      setType(initial.Type || DEFAULT_STORE_TYPE);
      // Coerce all incoming param values to strings for the form.
      const next: Record<string, string> = {};
      for (const [k, v] of Object.entries(initial.Params ?? {})) {
        next[k] = v == null ? '' : String(v);
      }
      setParams(next);
    } else {
      // Seed defaults so the user doesn't have to retype obvious values.
      const seeded: Record<string, string> = {};
      for (const f of STORE_TYPES[DEFAULT_STORE_TYPE].fields) {
        if (f.defaultValue !== undefined) seeded[f.key] = f.defaultValue;
      }
      setName('');
      setType(DEFAULT_STORE_TYPE);
      setParams(seeded);
    }
    setRevealed({});
    setError(null);
  }, [open, initial]);

  const def = STORE_TYPES[type] ?? STORE_TYPES[DEFAULT_STORE_TYPE];

  // Validation. Returns an error message, or null when the form is OK.
  const validationError = useMemo(() => {
    const trimmed = name.trim();
    if (!trimmed) return 'Name is required.';
    if (!/^[a-zA-Z0-9_-]+$/.test(trimmed)) {
      return 'Name can only contain letters, numbers, "-" and "_".';
    }
    if (existingNames.includes(trimmed)) return `A store named "${trimmed}" already exists.`;
    for (const f of def.fields) {
      if (f.required && !(params[f.key] ?? '').trim()) {
        return `${f.label} is required.`;
      }
    }
    return null;
  }, [name, def, params, existingNames]);

  const handleSubmit = () => {
    if (validationError) {
      setError(validationError);
      return;
    }
    // Build clean Params object: convert booleans, strip empty optional
    // strings, keep required values exactly as typed (incl. spaces).
    const cleanParams: Record<string, unknown> = {};
    for (const f of def.fields) {
      const raw = params[f.key] ?? '';
      if (f.kind === 'boolean') {
        cleanParams[f.key] = raw === 'true';
        continue;
      }
      const trimmed = raw.trim();
      if (!trimmed) continue;
      cleanParams[f.key] = trimmed;
    }
    onSubmit({ Name: name.trim(), Type: type, Params: cleanParams });
    onClose();
  };

  // Does this store type contain at least one secret field? Drives the
  // security note at the top of the body.
  const hasSecrets = def.fields.some((f) => f.secret);

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="md"
      title={isEdit ? `Edit Store — ${initial?.Name}` : 'Add Store'}
      footer={
        <div className="flex items-center justify-between gap-3">
          <span className="text-2xs text-ink-faint">
            {isEdit ? 'Changes apply to the current draft only.' : 'Stored on the flow.'}
          </span>
          <div className="flex items-center gap-2">
            <Button variant="ghost" type="button" onClick={onClose}>
              Cancel
            </Button>
            <Button
              variant="primary"
              type="button"
              onClick={handleSubmit}
              disabled={validationError !== null}
            >
              {isEdit ? 'Save' : 'Add Store'}
            </Button>
          </div>
        </div>
      }
    >
      <div className="flex flex-col gap-2">
        {hasSecrets ? <CredentialNotice /> : null}

        <InspectorRow label="Name" hint="Used to reference this store from Data Wells.">
          <IconInput
            mono
            prefix="N"
            value={name}
            placeholder="primary"
            onChange={(e) => setName(e.target.value)}
            // Don't allow renaming on edit — the rest of the flow
            // (data wells, etc.) reference the Store by name.
            disabled={isEdit}
          />
        </InspectorRow>

        <InspectorRow label="Type">
          <Dropdown value={type} onChange={(e) => setType(e.target.value)} disabled={isEdit}>
            {Object.entries(STORE_TYPES).map(([key, def]) => (
              <option key={key} value={key}>
                {def.label}
              </option>
            ))}
          </Dropdown>
        </InspectorRow>

        {def.fields.map((f) => {
          const value = params[f.key] ?? '';
          const update = (next: string) =>
            setParams((p) => ({ ...p, [f.key]: next }));
          return (
            <InspectorRow key={f.key} label={f.label} hint={f.hint}>
              {renderField(f, value, update, revealed, setRevealed)}
            </InspectorRow>
          );
        })}

        {error ? (
          <p className="px-1.5 pt-1 text-[10px] font-light leading-tight text-red-300">{error}</p>
        ) : null}
      </div>
    </Modal>
  );
}

/* ----------------------------- helpers ----------------------------- */

// Render the right control for a field. Kept as a free function so the
// modal body stays declarative.
function renderField(
  f: StoreField,
  value: string,
  onChange: (next: string) => void,
  revealed: Record<string, boolean>,
  setRevealed: React.Dispatch<React.SetStateAction<Record<string, boolean>>>,
) {
  const kind: StoreFieldKind = f.kind ?? (f.secret ? 'password' : 'text');

  if (kind === 'boolean') {
    return (
      <Checkbox
        checked={value === 'true'}
        onChange={(e) => onChange(e.target.checked ? 'true' : 'false')}
        label={f.placeholder ?? 'Enabled'}
      />
    );
  }

  if (kind === 'password') {
    const show = !!revealed[f.key];
    return (
      <div className="flex w-full items-center gap-1">
        <IconInput
          mono
          prefix={f.label[0]?.toUpperCase() ?? '·'}
          type={show ? 'text' : 'password'}
          value={value}
          placeholder={f.placeholder ?? ''}
          // Browsers love to autofill credential fields with whatever
          // happens to be in the page-credential store; opt out.
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => onChange(e.target.value)}
        />
        <button
          type="button"
          onClick={() => setRevealed((r) => ({ ...r, [f.key]: !r[f.key] }))}
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-row text-ink-faint hover:bg-raised hover:text-ink"
          aria-label={show ? 'Hide value' : 'Show value'}
          tabIndex={-1}
        >
          {show ? <EyeOff size={12} /> : <Eye size={12} />}
        </button>
      </div>
    );
  }

  return (
    <IconInput
      mono
      prefix={f.label[0]?.toUpperCase() ?? '·'}
      value={value}
      placeholder={f.placeholder ?? f.defaultValue ?? ''}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

// One-time security note shown above the form whenever any field is a
// secret. Wording lifted from `03-gaps-and-risks.md` §6 so the
// limitation is acknowledged in-product.
function CredentialNotice() {
  return (
    <div className="flex items-start gap-2 rounded-row border border-border bg-raised px-2 py-1.5 text-[10px] leading-tight text-ink-dim">
      <ShieldAlert size={12} className="mt-0.5 shrink-0 text-amber-300" />
      <span>
        Credentials are stored in plain text on the flow. They’re masked
        in the YAML preview, but commit to a secret manager before
        production. See <span className="font-mono">gaps §6</span>.
      </span>
    </div>
  );
}
