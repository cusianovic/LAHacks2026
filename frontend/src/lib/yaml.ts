// =====================================================================
// YAML/JSON serialization + command preview.
//
// All canvas data is stored as the typed `Flow` shape. This module is
// the only place that converts to/from text. Keeping it isolated means
// you can swap js-yaml for a different library, or pipe through a
// server-side formatter, without touching components.
// =====================================================================

import yaml from 'js-yaml';

import type { Flow, Step, Task } from '@/types/pupload';
import { isSecretParam } from '@/lib/storeSchema';

/* --------------------------- Serialize ----------------------------- */

export function flowToYAML(flow: Flow): string {
  return yaml.dump(flow, {
    noRefs: true,
    sortKeys: false,
    lineWidth: 100,
  });
}

export function flowToJSON(flow: Flow): string {
  return JSON.stringify(flow, null, 2);
}

/* ----------------------------- Redact ------------------------------ */
//
// Returns a deep copy of `flow` with credential-style Store params
// replaced by a fixed mask. Used by the YAML / JSON preview pane so
// secrets never appear in copy-pasteable form.
//
// What counts as a secret is defined in `lib/storeSchema.ts` —
// extending that registry automatically extends redaction here.
//
// IMPORTANT: this is UI-only. Secrets still travel as plain text in
// the actual save payload (`PUT /bff/project/:id`). See
// `03-gaps-and-risks.md` §6 for the planned vault-based fix.

const SECRET_MASK = '••••••';

export function redactSecrets(flow: Flow): Flow {
  return {
    ...flow,
    Stores: flow.Stores.map((store) => {
      if (!store.Params || Object.keys(store.Params).length === 0) return store;
      const safeParams: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(store.Params)) {
        // Mask if (a) the schema marks the key as secret, OR (b) we
        // can't recognise the type but the key heuristically looks
        // like a credential. Belt-and-braces.
        if (isSecretParam(store.Type, k) || looksSecret(k)) {
          // Only mask if there's an actual value — leave empties as-is
          // so the user sees "this isn't set" rather than a fake mask.
          safeParams[k] = v ? SECRET_MASK : v;
        } else {
          safeParams[k] = v;
        }
      }
      return { ...store, Params: safeParams };
    }),
  };
}

const SECRET_HEURISTIC = /(secret|password|passwd|token|api_key|apikey)/i;
function looksSecret(key: string): boolean {
  return SECRET_HEURISTIC.test(key);
}

/* -------------------------- Deserialize ---------------------------- */
// Used when the YAML panel becomes editable, or when the AI returns YAML.
// Lenient — caller should validate the result with `bff.validate`.

export function flowFromYAML(text: string): Flow {
  const parsed = yaml.load(text);
  return normalizeFlow(parsed);
}

export function flowFromJSON(text: string): Flow {
  const parsed = JSON.parse(text);
  return normalizeFlow(parsed);
}

function normalizeFlow(raw: unknown): Flow {
  // Minimal coercion. The real Go server will validate strictly;
  // this just protects the UI from totally malformed input.
  if (!raw || typeof raw !== 'object') {
    throw new Error('Flow is not an object');
  }
  const obj = raw as Partial<Flow>;
  return {
    Name: obj.Name ?? 'untitled',
    Timeout: obj.Timeout,
    Stores: obj.Stores ?? [],
    DefaultDataWell: obj.DefaultDataWell,
    DataWells: obj.DataWells ?? [],
    Steps: obj.Steps ?? [],
  };
}

/* --------------------- Command preview helper ---------------------- */
//
// Expands a Task.Command.Exec template using the values bound to a Step.
// The Pupload controller does the real interpolation at runtime — this
// is a faithful approximation for UI preview only.
//
// Recognized placeholders:
//   ${flag.NAME}           → step flag value
//   ${input.NAME}          → step input port edge name
//   ${output.NAME}         → step output port edge name
//   ${flag.NAME?default}   → flag with fallback default
//
// Unknown placeholders are left as `<missing:NAME>` so the user can spot
// unresolved references on the canvas.
//
// TODO(wire): once the controller exposes a /preview endpoint, prefer
//             that over this client-side approximation for parity.

export function expandCommand(task: Task | undefined, step: Step | undefined): string {
  if (!task || !step) return '';
  const exec = task.Command?.Exec ?? '';
  const flagMap = new Map(step.Flags.map((f) => [f.Name, f.Value]));
  const inputMap = new Map(step.Inputs.map((p) => [p.Name, p.Edge]));
  const outputMap = new Map(step.Outputs.map((p) => [p.Name, p.Edge]));

  return exec.replace(/\$\{(flag|input|output)\.([A-Za-z0-9_]+)(?:\?([^}]*))?\}/g,
    (_match, kind: string, name: string, fallback?: string) => {
      const resolved =
        kind === 'flag'   ? flagMap.get(name)
      : kind === 'input'  ? inputMap.get(name)
      : kind === 'output' ? outputMap.get(name)
      :                     undefined;
      if (resolved !== undefined && resolved !== '') return resolved;
      if (fallback !== undefined && fallback !== '') return fallback;
      return `<missing:${kind}.${name}>`;
    });
}
