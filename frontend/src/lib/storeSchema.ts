// =====================================================================
// Store schema — single source of truth for what each store TYPE wants
// in its `Params` map.
//
// This file is consumed by:
//   - `components/right/StoreEditorModal.tsx`  → renders the form
//   - `lib/yaml.ts::redactSecrets`             → masks secrets in preview
//
// Adding a new store type (e.g. `local`, `gcs`, `azure-blob`) is a one-
// block change here. Nothing else needs to be touched in either consumer.
// =====================================================================

export type StoreFieldKind = 'text' | 'password' | 'boolean';

export interface StoreField {
  key: string;
  label: string;
  /** Control kind. Defaults to 'text'; 'password' is implied when `secret`. */
  kind?: StoreFieldKind;
  required?: boolean;
  placeholder?: string;
  hint?: string;
  /** Pre-fill on Add when no value is supplied. */
  defaultValue?: string;
  /**
   * Marks the value as a credential. Two effects, kept in sync:
   *   1. Modal renders a password-style input with reveal toggle.
   *   2. `redactSecrets()` in `lib/yaml.ts` masks it (`••••••`).
   */
  secret?: boolean;
}

export interface StoreTypeDef {
  label: string;
  fields: StoreField[];
}

// To add a new store type, add another entry below.
//
// Field naming convention: snake_case keys (matches the spec in
// `01-ui-plan.md` and the AI fixture in `internal/api/bff/fixtures.go`).
export const STORE_TYPES: Record<string, StoreTypeDef> = {
  s3: {
    label: 'S3 (or S3-compatible)',
    fields: [
      {
        key: 'endpoint',
        label: 'Endpoint',
        required: true,
        placeholder: 'https://s3.amazonaws.com',
        defaultValue: 'https://s3.amazonaws.com',
        hint: 'AWS or S3-compatible host (MinIO, R2, B2, …)',
      },
      {
        key: 'bucket',
        label: 'Bucket',
        required: true,
        placeholder: 'my-bucket',
      },
      {
        key: 'access_key',
        label: 'Access key',
        required: true,
        placeholder: 'AKIA…',
        secret: true,
      },
      {
        key: 'secret_key',
        label: 'Secret key',
        required: true,
        placeholder: '••••••',
        secret: true,
      },
      {
        key: 'secure',
        label: 'Use TLS',
        kind: 'boolean',
        defaultValue: 'true',
        hint: 'Disable for plaintext HTTP endpoints (dev MinIO, etc.)',
      },
    ],
  },
};

export const DEFAULT_STORE_TYPE = 's3';

// Returns true when (storeType, paramKey) is a credential. Used both
// by the form (rendering a password input) and the YAML preview
// (substituting a mask).
export function isSecretParam(storeType: string, paramKey: string): boolean {
  const def = STORE_TYPES[storeType];
  if (!def) return false;
  return def.fields.some((f) => f.key === paramKey && f.secret);
}
