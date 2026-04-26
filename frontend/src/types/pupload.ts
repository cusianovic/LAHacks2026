// =====================================================================
// Pupload domain types — the contract between frontend and the BFF/engine.
//
// These mirror the Go models from `02-abstraction-layer.md` (Layer 1).
// Field names use the Go casing (PascalCase) so JSON marshaling lines up
// with the controller without a translation layer.
//
// ⚠️  When the real Go models land in `internal/models`, regenerate or
//     hand-mirror them here. This file is the single source of truth that
//     every component imports from.
//
// TODO(wire): regenerate from Go structs once the engine packages exist.
// =====================================================================

/* ------------------------------ Flow ------------------------------- */

export interface Flow {
  Name: string;
  Timeout?: string;
  Stores: StoreInput[];
  DefaultDataWell?: DataWell;
  DataWells: DataWell[];
  Steps: Step[];
}

export interface Step {
  ID: string;
  Uses: string;            // "publisher/name" — references a Task
  Inputs: StepEdge[];
  Outputs: StepEdge[];
  Flags: StepFlag[];
  Command: string;         // optional override of the task's default command name
}

export interface StepEdge {
  Name: string;            // port name, must match a TaskEdgeDef.Name on the referenced Task
  Edge: string;            // wire name connecting two ports
}

export interface StepFlag {
  Name: string;
  Value: string;
}

/* ------------------------------ Stores ----------------------------- */

export interface StoreInput {
  Name: string;
  Type: string;            // "s3" today, more later
  Params: Record<string, unknown>;
}

/* ----------------------------- DataWells --------------------------- */

// On-wire source values mirror the Go side (`Source string` with
// `omitempty`). The UI surfaces an additional "none" option that maps
// to `undefined` here, which serialises as a missing JSON field — i.e.
// `nil` on the backend. See `FlowSettingsPanel::SOURCE_OPTIONS`.
export type DataWellSource = 'upload' | 'static' | 'webhook';

export interface DataWell {
  Edge: string;
  Store: string;
  Source?: DataWellSource;
  Key?: string;
  Lifetime?: DataWellLifetime;
}

export interface DataWellLifetime {
  // Placeholder — extend with the real Go fields once they exist.
  TTL?: string;
}

/* ------------------------------ Tasks ------------------------------ */

export interface Task {
  Publisher: string;
  Name: string;
  Image: string;
  Inputs: TaskEdgeDef[];
  Outputs: TaskEdgeDef[];
  Flags: TaskFlagDef[];
  Command: TaskCommandDef;
  Tier: string;            // e.g. "c-small"
  MaxAttempts: number;
}

export interface TaskEdgeDef {
  Name: string;
  Description: string;
  Required: boolean;
  Type: string[];          // accepted mime types
}

export interface TaskFlagDef {
  Name: string;
  Description: string;
  Required: boolean;
  Type: string;            // e.g. "string", "int", "bool"
  Default?: string;
}

export interface TaskCommandDef {
  Name: string;
  Description: string;
  Exec: string;            // shell template with ${flag.X} / ${input.Y} / ${output.Z} placeholders
}

/* ------------------------------ Runs ------------------------------- */

export type FlowRunStatus =
  | 'STOPPED'
  | 'WAITING'
  | 'RUNNING'
  | 'COMPLETE'
  | 'ERROR';

export type StepRunStatus =
  | 'IDLE'
  | 'READY'
  | 'RUNNING'
  | 'RETRYING'
  | 'COMPLETE'
  | 'ERROR';

export interface FlowRun {
  ID: string;
  StepState: Record<string, StepState>;
  Status: FlowRunStatus;
  Artifacts: Record<string, Artifact>;
  WaitingURLs: WaitingURL[];
  StartedAt: string;
}

export interface StepState {
  Status: StepRunStatus;
  Logs: LogRecord[];
  Error: string;
  Attempt: number;
  MaxAttempts: number;
}

export interface LogRecord {
  Timestamp: string;
  Level: string;
  Message: string;
}

// Mirrors the controller's artifact descriptor (see
// `04-controller-api-reference.md` → WaitingURLs / Artifacts). The
// controller emits the *Name fields; MimeType is added by the worker
// once data lands so it's optional on the wire.
export interface Artifact {
  StoreName: string;
  ObjectName: string;
  EdgeName: string;
  MimeType?: string;
}

// WaitingURL is what the controller returns for any datawell with
// Source="upload" (and for step outputs while a step is running). The
// client must PUT raw bytes to `PutURL` before the controller will
// advance the flow.
export interface WaitingURL {
  Artifact: Artifact;
  PutURL: string;
  TTL?: string;
}

/* ---------------------- Run-time UI state ------------------------ */
// These types live entirely on the client and back the canvas's run
// animation. They never round-trip to the controller — the controller
// is the source of truth for `FlowRun`, and we derive UI state from
// each polled snapshot.

/**
 * Per-edge upload lifecycle for datawells with `Source="upload"`.
 *
 * - `pending`: controller is still waiting; user has not picked a file.
 * - `uploading`: PUT to the presigned URL is in flight.
 * - `uploaded`: PUT completed successfully.
 * - `failed`: PUT failed; the user can click again to retry.
 */
export type UploadEntryState = 'pending' | 'uploading' | 'uploaded' | 'failed';

/* ----------------------------- Project ----------------------------- */

export interface Project {
  ID: string;
  Flows: Flow[];
  Tasks: Task[];
  GlobalStores: StoreInput[];
}

/* --------------------------- Validation ---------------------------- */
// Mirrors the controller `/api/v1/flow/validate` response shape from
// `04-controller-api-reference.md`. The controller is the only
// validator the editor uses. The optional `StepID`/`Edge`/`Store`/
// `Field` fields are reserved for future controller versions that
// surface structured context for canvas decoration; today they're
// always undefined and the UI parses context out of `Description`.

export type ValidationKind = 'ValidationError' | 'ValidationWarning';

export interface ValidationEntry {
  Type: ValidationKind;
  Code: string;            // e.g. "NODE_001", "EDGE_003"
  Name: string;            // short title, e.g. "Task not found"
  Description: string;     // human-readable detail
  // Client-only context fields (always optional; ignored when round-
  // tripping to the controller).
  StepID?: string;
  Edge?: string;
  Store?: string;
  Field?: string;
}

export interface ValidationResult {
  Errors: ValidationEntry[];
  Warnings: ValidationEntry[];
}

/* ------------------------ BFF-only types --------------------------- */
// These never travel to the controller. They live on the BFF side
// (canvas positions, publish status) so the engine model stays clean.

export interface XY {
  x: number;
  y: number;
}

export interface CanvasLayout {
  flowName: string;
  nodePositions: Record<string, XY>;       // keyed by Step.ID
  datawellPositions: Record<string, XY>;   // keyed by DataWell.Edge
  zoom: number;
  offset: XY;
}

export type PublishStatus =
  | 'published'
  | 'unpublished_changes'
  | 'not_published';

export interface EnrichedProject {
  project: Project;
  layouts: Record<string, CanvasLayout>;   // keyed by Flow.Name
  publishStatus: PublishStatus;
}

/* --------------------- AI generation response ---------------------- */

export interface AIGenerateResult {
  flow: Flow;
  layout: CanvasLayout;
  newTasks: Task[];
  warnings: string[];
}

/* --------------------- UI-only canvas state ------------------------ */
// Selection & draft-edge state — purely React, never persisted.

export type SelectionType = 'step' | 'edge' | 'datawell' | 'none';

export interface SelectedElement {
  type: SelectionType;
  id: string;              // Step.ID, edge name, or datawell edge name
}

export interface DraftEdge {
  fromStepID: string;
  fromPort: string;
  mouseX: number;
  mouseY: number;
}
