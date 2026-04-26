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

export interface Artifact {
  Edge: string;
  Store: string;
  Key: string;
  MimeType: string;
}

export interface WaitingURL {
  Edge: string;
  URL: string;
}

/* ----------------------------- Project ----------------------------- */

export interface Project {
  ID: string;
  Flows: Flow[];
  Tasks: Task[];
  GlobalStores: StoreInput[];
}

/* --------------------------- Validation ---------------------------- */

export interface ValidationEntry {
  Code: string;            // e.g. "NODE_MISSING_INPUT", "EDGE_MIME_MISMATCH"
  Message: string;
  StepID?: string;
  Edge?: string;
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
