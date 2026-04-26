import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';

import { useActiveFlow, useFlowActions, useFlowDispatch } from '@/state/flowStore';
import {
  InspectorSection,
  InspectorRow,
  IconButton,
  IconInput,
  Dropdown,
} from '@/components/inspector';
import ListRow from '@/components/common/ListRow';
import StoreEditorModal from './StoreEditorModal';
import type { DataWell, DataWellSource, StoreInput } from '@/types/pupload';

// =====================================================================
// FlowSettingsPanel — shown when nothing on the canvas is selected.
// Edits the active flow's name, timeout, stores, datawells.
//
// Adjust the order of fields, or split into nested panels, as taste
// dictates. Each form control writes through `useFlowActions` /
// dispatch so autosave handles persistence.
// =====================================================================

// Dropdown options for `DataWell.Source`. The empty-string entry is
// the UI representation of `Source: undefined` — which serialises as
// a missing JSON field (i.e. `nil` on the Go side).
const SOURCE_OPTIONS: { value: '' | DataWellSource; label: string }[] = [
  { value: '', label: 'none' },
  { value: 'upload', label: 'upload' },
  { value: 'static', label: 'static' },
  { value: 'webhook', label: 'webhook' },
];

export default function FlowSettingsPanel() {
  const flow = useActiveFlow();
  const actions = useFlowActions();
  const dispatch = useFlowDispatch();

  // Store modal state. `null` (with `open=true`) is "Add". A `StoreInput`
  // is "Edit". `open=false` hides it.
  const [storeModalOpen, setStoreModalOpen] = useState(false);
  const [storeBeingEdited, setStoreBeingEdited] = useState<StoreInput | null>(null);

  if (!flow) {
    return (
      <div className="p-4 text-sm text-ink-faint">No flow selected.</div>
    );
  }

  const openAddStore = () => {
    setStoreBeingEdited(null);
    setStoreModalOpen(true);
  };

  const openEditStore = (store: StoreInput) => {
    setStoreBeingEdited(store);
    setStoreModalOpen(true);
  };

  // Submit handler shared by Add + Edit. In Add mode, `storeBeingEdited`
  // is null → append. In Edit mode it's the store before edits →
  // replace by Name (Name is locked in Edit so it's stable).
  const handleStoreSubmit = (next: StoreInput) => {
    if (storeBeingEdited) {
      actions.updateFlowSettings({
        Stores: flow.Stores.map((s) => (s.Name === storeBeingEdited.Name ? next : s)),
      });
    } else {
      actions.updateFlowSettings({ Stores: [...flow.Stores, next] });
    }
  };

  return (
    <div className="flex flex-col">
      <InspectorSection title="Flow">
        <InspectorRow label="Name">
          <IconInput
            prefix="N"
            value={flow.Name}
            onChange={(e) =>
              dispatch({ type: 'RENAME_FLOW', oldName: flow.Name, newName: e.target.value })
            }
          />
        </InspectorRow>
        <InspectorRow label="Timeout">
          <IconInput
            prefix="T"
            mono
            placeholder="5m"
            value={flow.Timeout ?? ''}
            onChange={(e) => actions.updateFlowSettings({ Timeout: e.target.value || undefined })}
          />
        </InspectorRow>
      </InspectorSection>

      <InspectorSection
        title="Stores"
        actions={
          <IconButton
            size="sm"
            aria-label="Add store"
            onClick={openAddStore}
            icon={<Plus size={12} />}
          />
        }
      >
        {flow.Stores.length === 0 ? (
          <EmptyHint>No stores yet.</EmptyHint>
        ) : (
          flow.Stores.map((store) => (
            <ListRow
              key={store.Name}
              mono
              onClick={() => openEditStore(store)}
              trailing={
                <IconButton
                  size="sm"
                  aria-label="Delete store"
                  onClick={(e) => {
                    e.stopPropagation();
                    dispatch({ type: 'DELETE_STORE', name: store.Name });
                  }}
                  icon={<Trash2 size={11} />}
                />
              }
            >
              <span className="flex flex-col leading-tight">
                <span className="truncate text-[11px] text-ink">{store.Name}</span>
                <span className="truncate text-[10px] text-ink-faint">
                  {storeSummary(store)}
                </span>
              </span>
            </ListRow>
          ))
        )}
      </InspectorSection>

      {/*
        DataWells are listed in the LEFT sidebar under "Items" alongside
        Steps. Adding new wells is exclusively the bottom toolbar's job
        (`AddDataWellPopover`). To edit one, select it on the canvas
        or in the sidebar — see `DataWellPanel`.
      */}

      <StoreEditorModal
        open={storeModalOpen}
        onClose={() => setStoreModalOpen(false)}
        initial={storeBeingEdited}
        existingNames={flow.Stores.map((s) => s.Name).filter(
          (n) => n !== storeBeingEdited?.Name,
        )}
        onSubmit={handleStoreSubmit}
      />

      {/*
        Default Data Well.

        Per `02-abstraction-layer.md`, this field IS a `DataWell` (not
        a reference to one in the list above). It's the fallback well
        used by any step output whose `Edge` doesn't match an entry in
        `flow.DataWells`. We render it with the SAME inline editor as
        the list so the relationship is unambiguous — just with
        `Edge` locked, since the default has no edge name of its own.
      */}
      <InspectorSection
        title="Default Data Well"
        actions={
          flow.DefaultDataWell ? null : (
            <IconButton
              size="sm"
              aria-label="Set default data well"
              onClick={() =>
                // Same default as a fresh DataWell: source is `none`
                // until the user explicitly opts in.
                actions.updateFlowSettings({
                  DefaultDataWell: {
                    Edge: '',
                    Store: flow.Stores[0]?.Name ?? '',
                    Key: '${RUN_ID}/${EDGE}',
                  },
                })
              }
              icon={<Plus size={12} />}
            />
          )
        }
      >
        {flow.DefaultDataWell ? (
          <DataWellInlineEditor
            well={flow.DefaultDataWell}
            storeOptions={flow.Stores.map((s) => s.Name)}
            edgeLabel="(default)"
            onChangeSource={(s) =>
              actions.updateFlowSettings({
                DefaultDataWell: { ...flow.DefaultDataWell!, Source: s },
              })
            }
            onChangeStore={(s) =>
              actions.updateFlowSettings({
                DefaultDataWell: { ...flow.DefaultDataWell!, Store: s },
              })
            }
            onChangeKey={(k) =>
              actions.updateFlowSettings({
                DefaultDataWell: { ...flow.DefaultDataWell!, Key: k },
              })
            }
            onDelete={() => actions.updateFlowSettings({ DefaultDataWell: undefined })}
          />
        ) : (
          <EmptyHint>No default. Step outputs with no DataWell will fail validation.</EmptyHint>
        )}
      </InspectorSection>
    </div>
  );
}

/* --------------------------- helpers ------------------------------- */

// Compact one-liner describing a store's wiring — e.g. "s3 · my-bucket".
// We pick the most identifying param per type so users can scan the
// list without opening each row.
function storeSummary(store: StoreInput): string {
  const type = store.Type || '?';
  const params = store.Params ?? {};
  const primary =
    (params.bucket as string | undefined) ??
    (params.path as string | undefined) ??
    (params.endpoint as string | undefined) ??
    '';
  return primary ? `${type} · ${primary}` : type;
}

function EmptyHint({ children }: { children: React.ReactNode }) {
  return (
    <p className="px-1.5 py-1 text-[10px] font-light leading-none text-ink-faint">
      {children}
    </p>
  );
}

// One data-well row with inline source/store/key editors. Kept compact:
// label row on top (with delete), source + store on one line, key on
// the next.
//
// `edgeLabel` lets the caller override what gets shown in the header
// row — used by the DefaultDataWell editor to render "(default)"
// instead of the (meaningless) `well.Edge`.
function DataWellInlineEditor({
  well,
  storeOptions,
  edgeLabel,
  onChangeSource,
  onChangeStore,
  onChangeKey,
  onDelete,
}: {
  well: DataWell;
  storeOptions: string[];
  edgeLabel?: string;
  // `undefined` means "none" (serialises as nil on the backend).
  onChangeSource: (s: DataWellSource | undefined) => void;
  onChangeStore: (s: string) => void;
  onChangeKey: (k: string) => void;
  onDelete: () => void;
}) {
  return (
    <div className="flex flex-col gap-1.5 rounded-row bg-raised/40 p-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="truncate font-mono text-[11px] leading-none text-ink">
          {edgeLabel ?? well.Edge}
        </span>
        <IconButton
          size="sm"
          aria-label="Delete data well"
          onClick={onDelete}
          icon={<Trash2 size={11} />}
        />
      </div>
      <div className="flex gap-1.5">
        <Dropdown
          value={well.Source ?? ''}
          onChange={(e) => {
            const v = e.target.value;
            onChangeSource(v === '' ? undefined : (v as DataWellSource));
          }}
        >
          {SOURCE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </Dropdown>
        <Dropdown value={well.Store} onChange={(e) => onChangeStore(e.target.value)}>
          <option value="">— store —</option>
          {storeOptions.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </Dropdown>
      </div>
      <IconInput
        mono
        prefix="K"
        placeholder="${RUN_ID}/${EDGE}"
        value={well.Key ?? ''}
        onChange={(e) => onChangeKey(e.target.value)}
      />
    </div>
  );
}
