// =====================================================================
// FlowStore — the single source of truth for the editor.
//
// One reducer, one Context, two hooks:
//
//   useFlowState()    → read state
//   useFlowDispatch() → dispatch actions defined in `actions.ts`
//
// Side-effect (autosave to BFF) lives at the bottom in `useAutosave`.
// Never mutate flow data with useState in components — go through here.
// =====================================================================

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  type ReactNode,
} from 'react';

import { bff, DEFAULT_PROJECT_ID } from '@/lib/bff';
import { autoLayout } from '@/lib/autoLayout';
import type {
  CanvasLayout,
  DataWell,
  Flow,
  FlowRun,
  FlowRunStatus,
  Project,
  PublishStatus,
  SelectedElement,
  Step,
  StepEdge,
  StepRunStatus,
  Task,
  UploadEntryState,
  ValidationResult,
} from '@/types/pupload';

import type { BottomPanelFormat, FlowAction } from './actions';

/* ----------------------------- State ------------------------------- */

export interface FlowStoreState {
  status: 'idle' | 'loading' | 'ready' | 'error';
  error: string | null;

  projectID: string;
  project: Project;
  layouts: Record<string, CanvasLayout>;
  publishStatus: PublishStatus;

  activeFlowName: string;
  selection: SelectedElement;

  yamlPanel: {
    open: boolean;
    format: BottomPanelFormat;
  };

  /**
   * Latest validation result, owned by the store and populated by
   * `useControllerValidation` (a debounced call to the controller via
   * the BFF). Components read it via `useFlowValidation()`.
   *
   * Empty arrays mean either "not yet validated" or "valid" — callers
   * generally treat them as "nothing to show". Run/Publish gating
   * keys off `Errors.length`, which lets a fresh edit through until
   * the next validation roundtrip completes (~400ms debounce).
   */
  validation: ValidationResult;

  /**
   * Live state for the currently-executing flow run. Drives the
   * canvas animations on `StepNode` and the per-edge upload UX on
   * `DataWellNode`. See `RunState` below.
   */
  runState: RunState;

  /** Bumped on every mutation; the autosave effect keys off this. */
  revision: number;
}

/* ----------------------------- RunState ---------------------------- */
//
// Phase machine for the canvas “Run” UX. The store owns this slice;
// `BottomBar` writes the lifecycle, `useRunPoller` writes snapshot
// updates, and the canvas reads to paint per-node status.
//
//   idle ── RUN_START ──▶ starting
//                          │ testFlow returns
//                          ▼
//                       awaiting_uploads (controller WAITING)
//                          │ every needed upload completes
//                          ▼
//                       running (controller RUNNING)
//                          │
//                          ▼
//                       complete | error
//
// Switching flows during a run does NOT reset; we just hide run
// decoration on flows whose `Name` doesn't match `flowName`.

export type RunPhase =
  | 'idle'
  | 'starting'
  | 'awaiting_uploads'
  | 'running'
  | 'complete'
  | 'error';

export interface UploadEntry {
  /** Latest presigned URL from the controller. Refreshed on each poll. */
  putURL: string;
  state: UploadEntryState;
  errorMessage?: string;
}

export interface RunState {
  phase: RunPhase;
  /** Set once `bff.testFlow` returns; used as the polling key. */
  runID: string | null;
  /** Which flow this run belongs to. Canvas decoration is gated on this. */
  flowName: string | null;
  /** Last `Status` field from the polled `FlowRun`. */
  flowStatus: FlowRunStatus | null;
  /** Step.ID → latest controller-reported status. */
  stepStatuses: Record<string, StepRunStatus>;
  /** DataWell.Edge → upload lifecycle entry. Only populated for `Source="upload"` wells. */
  uploads: Record<string, UploadEntry>;
  /** Reason the run never started (testFlow failure). Cleared on next RUN_START. */
  errorMessage: string | null;
}

const EMPTY_RUN_STATE: RunState = {
  phase: 'idle',
  runID: null,
  flowName: null,
  flowStatus: null,
  stepStatuses: {},
  uploads: {},
  errorMessage: null,
};

const EMPTY_PROJECT: Project = {
  ID: DEFAULT_PROJECT_ID,
  Flows: [],
  Tasks: [],
  GlobalStores: [],
};

const EMPTY_VALIDATION: ValidationResult = { Errors: [], Warnings: [] };

const INITIAL: FlowStoreState = {
  status: 'idle',
  error: null,
  projectID: DEFAULT_PROJECT_ID,
  project: EMPTY_PROJECT,
  layouts: {},
  publishStatus: 'not_published',
  activeFlowName: '',
  selection: { type: 'none', id: '' },
  yamlPanel: { open: false, format: 'yaml' },
  validation: EMPTY_VALIDATION,
  runState: EMPTY_RUN_STATE,
  revision: 0,
};

/* ----------------------------- Reducer ----------------------------- */

function bump(s: FlowStoreState): FlowStoreState {
  return { ...s, revision: s.revision + 1, publishStatus: 'unpublished_changes' };
}

function reducer(state: FlowStoreState, action: FlowAction): FlowStoreState {
  switch (action.type) {
    /* ------------------------- lifecycle ------------------------- */
    case 'PROJECT_LOADED': {
      const { project, layouts, publishStatus } = action.payload;
      const firstFlow = project.Flows[0]?.Name ?? '';
      // We deliberately do NOT auto-collapse pre-1:1 duplicate
      // outputs here: the legacy fan-out shape (multiple Output
      // entries with the same `Name`, different `Edge`) carries real
      // connections, and a naive collapse would orphan the consumers
      // attached to the dropped branches. Instead, `setPortEdge`
      // collapses lazily the next time the user explicitly re-binds a
      // port (via the inspector or by drawing a new wire). Until
      // then, `buildEdges` and `inferPorts` already render legacy
      // duplicates correctly: edges are drawn per Output entry,
      // visual port handles are deduped by `Name`.
      return {
        ...state,
        status: 'ready',
        error: null,
        project,
        layouts,
        publishStatus,
        activeFlowName: state.activeFlowName || firstFlow,
        selection: { type: 'none', id: '' },
        // Wipe stale validation from a previous project/session — the
        // fetcher effect will repopulate against the freshly loaded
        // active flow on the next tick.
        validation: EMPTY_VALIDATION,
        revision: state.revision + 1,
      };
    }
    case 'PROJECT_LOAD_FAILED':
      return { ...state, status: 'error', error: action.error };

    case 'PUBLISH_STATUS':
      return { ...state, publishStatus: action.status };

    /* ----------------------- flow management --------------------- */
    case 'SELECT_FLOW':
      // Clear validation so the Issues tab / button badges don't show
      // stale results from the previous flow during the debounce gap.
      return {
        ...state,
        activeFlowName: action.flowName,
        selection: { type: 'none', id: '' },
        validation: EMPTY_VALIDATION,
      };

    case 'CREATE_FLOW': {
      const exists = state.project.Flows.some((f) => f.Name === action.flow.Name);
      if (exists) return state;
      const project = {
        ...state.project,
        Flows: [...state.project.Flows, action.flow],
      };
      const layouts = {
        ...state.layouts,
        [action.flow.Name]: autoLayout(action.flow),
      };
      return bump({ ...state, project, layouts, activeFlowName: action.flow.Name });
    }

    case 'RENAME_FLOW': {
      const project = {
        ...state.project,
        Flows: state.project.Flows.map((f) =>
          f.Name === action.oldName ? { ...f, Name: action.newName } : f,
        ),
      };
      const layouts = { ...state.layouts };
      if (layouts[action.oldName]) {
        layouts[action.newName] = { ...layouts[action.oldName], flowName: action.newName };
        delete layouts[action.oldName];
      }
      return bump({
        ...state,
        project,
        layouts,
        activeFlowName: state.activeFlowName === action.oldName ? action.newName : state.activeFlowName,
      });
    }

    case 'DELETE_FLOW': {
      const project = {
        ...state.project,
        Flows: state.project.Flows.filter((f) => f.Name !== action.flowName),
      };
      const layouts = { ...state.layouts };
      delete layouts[action.flowName];
      const activeFlowName =
        state.activeFlowName === action.flowName
          ? (project.Flows[0]?.Name ?? '')
          : state.activeFlowName;
      return bump({ ...state, project, layouts, activeFlowName, selection: { type: 'none', id: '' } });
    }

    case 'UPDATE_FLOW_SETTINGS': {
      return bump({
        ...state,
        project: mapActiveFlow(state, (f) => ({ ...f, ...action.patch })),
      });
    }

    /* ------------------------ canvas selection ------------------- */
    case 'SELECT_ELEMENT':
      return { ...state, selection: action.element };

    /* ----------------------------- steps ------------------------- */
    case 'ADD_STEP': {
      const project = mapActiveFlow(state, (f) => ({
        ...f,
        Steps: [...f.Steps, action.step],
      }));
      const layouts = setNodePosition(state, 'step', action.step.ID, action.position);
      return bump({ ...state, project, layouts });
    }

    case 'UPDATE_STEP': {
      const project = mapActiveFlow(state, (f) => ({
        ...f,
        Steps: f.Steps.map((s) => (s.ID === action.id ? { ...s, ...action.patch } : s)),
      }));
      return bump({ ...state, project });
    }

    case 'DELETE_STEP': {
      const project = mapActiveFlow(state, (f) => ({
        ...f,
        Steps: f.Steps.filter((s) => s.ID !== action.id),
      }));
      const layouts = { ...state.layouts };
      const layout = layouts[state.activeFlowName];
      if (layout) {
        const np = { ...layout.nodePositions };
        delete np[action.id];
        layouts[state.activeFlowName] = { ...layout, nodePositions: np };
      }
      const sel = state.selection.type === 'step' && state.selection.id === action.id
        ? { type: 'none' as const, id: '' }
        : state.selection;
      return bump({ ...state, project, layouts, selection: sel });
    }

    // RENAME_STEP swaps a step's ID. The ID is keyed everywhere — on
    // the step itself, on the layout's node-position map, on the
    // canvas selection — so we migrate all three atomically.
    //
    // Edge names are NOT rewritten. Edges minted by `CONNECT_PORTS`
    // bake the source step's ID at connect time (`${stepID}_${port}`),
    // but they're opaque strings to every consumer afterwards. Rewriting
    // them would mean walking every step's Inputs/Outputs in this flow,
    // which is invasive for a cosmetic change. The user is free to
    // delete + re-create edges if they want the topic name refreshed.
    //
    // No-ops:
    //   - newID equal to oldID (nothing to do)
    //   - newID empty (would create an unaddressable step)
    //   - newID already used by another step in the same flow
    //     (would violate NODE_007 — duplicate IDs)
    case 'RENAME_STEP': {
      const trimmed = action.newID.trim();
      if (trimmed === '' || trimmed === action.oldID) return state;
      const flow = state.project.Flows.find((f) => f.Name === state.activeFlowName);
      if (!flow) return state;
      if (flow.Steps.some((s) => s.ID === trimmed)) {
        // Duplicate ID — silently ignore. Caller should pre-validate
        // and surface a message, but the reducer stays defensive.
        return state;
      }
      const project = mapActiveFlow(state, (f) => ({
        ...f,
        Steps: f.Steps.map((s) =>
          s.ID === action.oldID ? { ...s, ID: trimmed } : s,
        ),
      }));
      const layouts = { ...state.layouts };
      const layout = layouts[state.activeFlowName];
      if (layout && action.oldID in layout.nodePositions) {
        const { [action.oldID]: pos, ...rest } = layout.nodePositions;
        layouts[state.activeFlowName] = {
          ...layout,
          nodePositions: { ...rest, [trimmed]: pos },
        };
      }
      const sel = state.selection.type === 'step' && state.selection.id === action.oldID
        ? { type: 'step' as const, id: trimmed }
        : state.selection;
      return bump({ ...state, project, layouts, selection: sel });
    }

    /* ---------------------------- layout ------------------------- */
    case 'MOVE_NODE': {
      const layouts = setNodePosition(state, action.kind, action.id, action.position);
      return { ...state, layouts, revision: state.revision + 1 };
    }

    case 'SET_VIEWPORT': {
      const layouts = { ...state.layouts };
      const layout = layouts[state.activeFlowName];
      if (!layout) return state;
      layouts[state.activeFlowName] = { ...layout, zoom: action.zoom, offset: action.offset };
      return { ...state, layouts };
    }

    /* ----------------------------- edges ------------------------- */
    // CONNECT_PORTS wires `fromStep:fromPort → toStep:toPort`. Both
    // sides obey the 1:1 rule (one edge per port `Name`); fan-out is
    // achieved by *sharing the same edge name* across many input
    // ports, not by stacking entries on the output side.
    //
    // Edge-name resolution:
    //   1. Use `action.edgeName` if the caller supplied one.
    //   2. Else reuse the source output's existing `Edge` if non-empty
    //      — that's how a second consumer joins an existing topic.
    //   3. Otherwise mint a stable `${stepID}_${portName}` topic; step
    //      IDs are unique per flow, so collisions are impossible.
    case 'CONNECT_PORTS': {
      const fromStep = state.project.Flows
        .find((f) => f.Name === state.activeFlowName)
        ?.Steps.find((s) => s.ID === action.fromStepID);
      const existingOutEdge = fromStep?.Outputs.find(
        (o) => o.Name === action.fromPort,
      )?.Edge;
      const edgeName =
        action.edgeName ||
        (existingOutEdge && existingOutEdge !== ''
          ? existingOutEdge
          : `${action.fromStepID}_${action.fromPort}`);
      const project = mapActiveFlow(state, (f) => ({
        ...f,
        Steps: f.Steps.map((s) => {
          if (s.ID === action.fromStepID) {
            return { ...s, Outputs: bindOutput(s.Outputs, action.fromPort, edgeName) };
          }
          if (s.ID === action.toStepID) {
            return { ...s, Inputs: bindInput(s.Inputs, action.toPort, edgeName) };
          }
          return s;
        }),
      }));
      return bump({ ...state, project });
    }

    // DELETE_EDGE clears the edge on both producers and consumers.
    // Port placeholders survive (Edge: '') so the inspector still
    // renders the row — the task definition is the source of truth
    // for "which ports exist".
    case 'DELETE_EDGE': {
      const project = mapActiveFlow(state, (f) => ({
        ...f,
        Steps: f.Steps.map((s) => dropEdgeFromStep(s, action.edgeName)),
      }));
      return bump({ ...state, project });
    }

    /* --------------------------- datawells ----------------------- */
    case 'ADD_DATAWELL': {
      const project = mapActiveFlow(state, (f) => ({
        ...f,
        DataWells: [...f.DataWells, action.well],
      }));
      const layouts = setNodePosition(state, 'datawell', action.well.Edge, action.position);
      return bump({ ...state, project, layouts });
    }

    case 'UPDATE_DATAWELL': {
      const project = mapActiveFlow(state, (f) => ({
        ...f,
        DataWells: f.DataWells.map((w) => (w.Edge === action.edge ? { ...w, ...action.patch } : w)),
      }));
      return bump({ ...state, project });
    }

    case 'DELETE_DATAWELL': {
      // Removing a well takes its edge with it, so cascade the same
      // step-binding cleanup as DELETE_EDGE — otherwise dangling
      // `Edge` references survive in step Inputs/Outputs and the
      // controller validator flags them on the next roundtrip.
      const project = mapActiveFlow(state, (f) => ({
        ...f,
        DataWells: f.DataWells.filter((w) => w.Edge !== action.edge),
        Steps: f.Steps.map((s) => dropEdgeFromStep(s, action.edge)),
      }));
      const layouts = { ...state.layouts };
      const layout = layouts[state.activeFlowName];
      if (layout) {
        const dp = { ...layout.datawellPositions };
        delete dp[action.edge];
        layouts[state.activeFlowName] = { ...layout, datawellPositions: dp };
      }
      // Mirror DELETE_STEP: clear the current selection if it pointed
      // at the well we just deleted, so the right inspector doesn't
      // keep showing a stale form.
      const sel = state.selection.type === 'datawell' && state.selection.id === action.edge
        ? { type: 'none' as const, id: '' }
        : state.selection;
      return bump({ ...state, project, layouts, selection: sel });
    }

    /* ---------------------------- stores ------------------------- */
    case 'UPSERT_STORE': {
      const project = mapActiveFlow(state, (f) => {
        const exists = f.Stores.some((s) => s.Name === action.store.Name);
        return {
          ...f,
          Stores: exists
            ? f.Stores.map((s) => (s.Name === action.store.Name ? action.store : s))
            : [...f.Stores, action.store],
        };
      });
      return bump({ ...state, project });
    }

    case 'DELETE_STORE': {
      const project = mapActiveFlow(state, (f) => ({
        ...f,
        Stores: f.Stores.filter((s) => s.Name !== action.name),
      }));
      return bump({ ...state, project });
    }

    /* ----------------------------- tasks ------------------------- */
    case 'ADD_TASK':
      return bump({
        ...state,
        project: { ...state.project, Tasks: [...state.project.Tasks, action.task] },
      });

    case 'SET_TASKS':
      return bump({ ...state, project: { ...state.project, Tasks: action.tasks } });

    /* ------------------------ ai hydration ----------------------- */
    case 'HYDRATE_FROM_AI': {
      const projectFlows = state.project.Flows.some((f) => f.Name === action.flow.Name)
        ? state.project.Flows.map((f) => (f.Name === action.flow.Name ? action.flow : f))
        : [...state.project.Flows, action.flow];
      const newTaskKeys = new Set(action.newTasks.map((t) => `${t.Publisher}/${t.Name}`));
      const tasksKept = state.project.Tasks.filter(
        (t) => !newTaskKeys.has(`${t.Publisher}/${t.Name}`),
      );
      const project: Project = {
        ...state.project,
        Flows: projectFlows,
        Tasks: [...tasksKept, ...action.newTasks],
      };
      const layouts = { ...state.layouts, [action.flow.Name]: action.layout };
      return bump({
        ...state,
        project,
        layouts,
        activeFlowName: action.flow.Name,
        selection: { type: 'none', id: '' },
      });
    }

    /* --------------------------- yaml panel ---------------------- */
    case 'TOGGLE_YAML':
      return {
        ...state,
        yamlPanel: {
          open: !state.yamlPanel.open || action.format !== state.yamlPanel.format,
          format: action.format ?? state.yamlPanel.format,
        },
      };
    case 'CLOSE_YAML':
      return { ...state, yamlPanel: { ...state.yamlPanel, open: false } };

    /* --------------------- controller validation ----------------- */
    // Pure write — never goes through `bump()` so it can't trigger
    // another validation round (which would loop forever).
    case 'SET_VALIDATION':
      return { ...state, validation: action.result };

    /* --------------------- run lifecycle ------------------------- */
    // None of these go through `bump()` — run state is ephemeral and
    // must not bleed into autosave or trigger validation re-fetches.
    case 'RUN_START':
      return {
        ...state,
        runState: {
          ...EMPTY_RUN_STATE,
          phase: 'starting',
          flowName: action.flowName,
        },
      };

    case 'RUN_SNAPSHOT':
      return { ...state, runState: applyRunSnapshot(state, action.run) };

    case 'RUN_FAILED':
      return {
        ...state,
        runState: { ...state.runState, phase: 'error', errorMessage: action.error },
      };

    case 'RUN_RESET':
      return { ...state, runState: EMPTY_RUN_STATE };

    case 'SET_UPLOAD_STATE': {
      const existing = state.runState.uploads[action.edge];
      if (!existing) return state;
      return {
        ...state,
        runState: {
          ...state.runState,
          uploads: {
            ...state.runState.uploads,
            [action.edge]: {
              ...existing,
              state: action.state,
              errorMessage: action.errorMessage,
            },
          },
        },
      };
    }
  }
}

/* --------------------- run snapshot reducer helper ----------------- */
// Merges a polled `FlowRun` into the existing `RunState`.
//
//   - Step statuses are taken verbatim from the controller.
//   - `WaitingURLs` are filtered to upload-source datawells of the
//     run's flow (the controller also lists step-output staging URLs;
//     those are managed by the worker, not the user, so we don't
//     surface them on the canvas).
//   - For each upload edge: if we don't have an entry yet, or the
//     entry is still `pending`/`failed`, refresh `putURL` (the TTL may
//     have rotated). Entries already in `uploading`/`uploaded` are
//     left alone — the user has agency over them.
//   - The terminal `complete`/`error` phases mirror `FlowRun.Status`.
function applyRunSnapshot(state: FlowStoreState, run: FlowRun): RunState {
  const stepStatuses: Record<string, StepRunStatus> = {};
  for (const [id, s] of Object.entries(run.StepState ?? {})) {
    stepStatuses[id] = s.Status;
  }

  const flowName = state.runState.flowName ?? state.activeFlowName;
  const flow = state.project.Flows.find((f) => f.Name === flowName);
  const uploadEdges = new Set(
    flow?.DataWells.filter((w) => w.Source === 'upload').map((w) => w.Edge) ?? [],
  );

  const uploads = { ...state.runState.uploads };
  for (const w of run.WaitingURLs ?? []) {
    const edge = w.Artifact?.EdgeName;
    if (!edge || !uploadEdges.has(edge)) continue;
    const existing = uploads[edge];
    if (!existing || existing.state === 'pending' || existing.state === 'failed') {
      uploads[edge] = { putURL: w.PutURL, state: existing?.state ?? 'pending' };
    }
  }

  const phase: RunPhase =
    run.Status === 'COMPLETE'
      ? 'complete'
      : run.Status === 'ERROR'
        ? 'error'
        : run.Status === 'WAITING'
          ? 'awaiting_uploads'
          : 'running';

  return {
    ...state.runState,
    phase,
    runID: run.ID,
    flowName,
    flowStatus: run.Status,
    stepStatuses,
    uploads,
  };
}

/* ----------------------- port-binding helpers ---------------------- */
//
// `Step.Outputs` and `Step.Inputs` share the same `StepEdge[]` shape
// and the same 1:1 binding rule:
//
//   * One entry per port `Name`. Wiring the same port again overwrites
//     its `Edge`. Clearing the binding (`Edge: ''`) keeps the port
//     placeholder so the inspector still renders the row.
//
// Fan-out is a property of the *edge name*, not of the output entry:
// an output port has a single edge name (the "topic"), and any number
// of input ports across the flow can subscribe by setting the same
// edge name on their own binding. This mirrors the controller's flow
// schema (cf. `04-controller-api-reference.md`) where a step output's
// `Edge` field is the publish target and consumers reference it by
// name.
//
// Centralising the rule here keeps the reducer (`CONNECT_PORTS`,
// `DELETE_EDGE`, ...), the canvas (`FlowCanvas::bindStepPort`), and
// the inspector (`StepConfigPanel`) in lock-step.

/**
 * Set the (single) edge for a port and collapse any duplicate entries
 * sharing the same `Name`. The first occurrence wins (its position in
 * the array is preserved, but its `Edge` is replaced); subsequent
 * duplicates are dropped. If no entry exists, a new one is appended.
 *
 * The duplicate-collapse is what migrates pre-1:1 flows in place: the
 * earlier model allowed multiple output entries with the same `Name`
 * (one per fan-out branch), and the next interaction with a port that
 * had been wired that way will normalize it without a separate
 * migration pass.
 *
 * Pass `''` as `edge` to clear the binding while keeping the port
 * placeholder visible (the inspector still renders the row).
 */
function setPortEdge(
  ports: StepEdge[],
  name: string,
  edge: string,
): StepEdge[] {
  let placed = false;
  const out: StepEdge[] = [];
  for (const p of ports) {
    if (p.Name !== name) {
      out.push(p);
      continue;
    }
    if (placed) continue;
    out.push({ ...p, Edge: edge });
    placed = true;
  }
  if (!placed) out.push({ Name: name, Edge: edge });
  return out;
}

/** 1:1 binding for an input port. See `setPortEdge`. */
export function bindInput(
  ports: StepEdge[],
  name: string,
  edge: string,
): StepEdge[] {
  return setPortEdge(ports, name, edge);
}

/**
 * 1:1 binding for an output port. Multiple downstream inputs subscribe
 * by referencing this same edge name; the output owns the topic, not
 * a list of destinations. See `setPortEdge` for the dedupe semantics.
 */
export function bindOutput(
  ports: StepEdge[],
  name: string,
  edge: string,
): StepEdge[] {
  return setPortEdge(ports, name, edge);
}

/**
 * Cascade-clean an edge from a step: clears any input or output bound
 * to it. The port placeholder survives so the canvas/inspector still
 * render the row — the task definition is the source of truth for
 * which ports exist.
 *
 * Used by both DELETE_EDGE (canvas/inspector "Disconnect") and
 * DELETE_DATAWELL (which implicitly takes its edge with it).
 */
export function dropEdgeFromStep(step: Step, edgeName: string): Step {
  return {
    ...step,
    Inputs: step.Inputs.map((i) => (i.Edge === edgeName ? { ...i, Edge: '' } : i)),
    Outputs: step.Outputs.map((o) => (o.Edge === edgeName ? { ...o, Edge: '' } : o)),
  };
}

/* ------------------------- reducer helpers ------------------------- */

function mapActiveFlow(state: FlowStoreState, fn: (f: Flow) => Flow): Project {
  return {
    ...state.project,
    Flows: state.project.Flows.map((f) =>
      f.Name === state.activeFlowName ? fn(f) : f,
    ),
  };
}

function setNodePosition(
  state: FlowStoreState,
  kind: 'step' | 'datawell',
  id: string,
  position: { x: number; y: number },
): Record<string, CanvasLayout> {
  const layouts = { ...state.layouts };
  const existing = layouts[state.activeFlowName] ?? {
    flowName: state.activeFlowName,
    nodePositions: {},
    datawellPositions: {},
    zoom: 1,
    offset: { x: 0, y: 0 },
  };
  const updated: CanvasLayout = {
    ...existing,
    nodePositions: kind === 'step'
      ? { ...existing.nodePositions, [id]: position }
      : existing.nodePositions,
    datawellPositions: kind === 'datawell'
      ? { ...existing.datawellPositions, [id]: position }
      : existing.datawellPositions,
  };
  layouts[state.activeFlowName] = updated;
  return layouts;
}

/* ----------------------------- Context ----------------------------- */

const StateCtx = createContext<FlowStoreState | null>(null);
const DispatchCtx = createContext<((action: FlowAction) => void) | null>(null);

export function FlowStoreProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, INITIAL);

  /* -------- bootstrap: load project once on mount -------- */
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const enriched = await bff.loadProject(DEFAULT_PROJECT_ID);
        if (cancelled) return;
        dispatch({ type: 'PROJECT_LOADED', payload: enriched });
      } catch (err) {
        if (cancelled) return;
        dispatch({
          type: 'PROJECT_LOAD_FAILED',
          error: err instanceof Error ? err.message : 'Failed to load project',
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /* -------- autosave: debounced PUT on every revision bump -------- */
  useAutosave(state);

  /* -------- validation: debounced controller roundtrip ----------- */
  useControllerValidation(state, dispatch);

  /* -------- run polling: drives canvas status updates ------------ */
  useRunPoller(state.runState.runID, state.runState.phase, dispatch);

  return (
    <StateCtx.Provider value={state}>
      <DispatchCtx.Provider value={dispatch}>{children}</DispatchCtx.Provider>
    </StateCtx.Provider>
  );
}

/* ----------------------------- Hooks ------------------------------- */

export function useFlowState(): FlowStoreState {
  const ctx = useContext(StateCtx);
  if (!ctx) throw new Error('useFlowState must be used inside <FlowStoreProvider>');
  return ctx;
}

export function useFlowDispatch(): (action: FlowAction) => void {
  const ctx = useContext(DispatchCtx);
  if (!ctx) throw new Error('useFlowDispatch must be used inside <FlowStoreProvider>');
  return ctx;
}

/** Returns the currently selected flow object (or undefined if none). */
export function useActiveFlow(): Flow | undefined {
  const { project, activeFlowName } = useFlowState();
  return useMemo(
    () => project.Flows.find((f) => f.Name === activeFlowName),
    [project.Flows, activeFlowName],
  );
}

export function useTasks(): Task[] {
  return useFlowState().project.Tasks;
}

/**
 * Live validation result for the active flow. The store owns the
 * actual fetch (see `useControllerValidation` below) — this hook just
 * exposes the latest result.
 *
 * Returns `{Errors:[],Warnings:[]}` until the first roundtrip lands
 * (and after every flow switch, while the next request is in flight).
 * Treat the empty case as "nothing to show yet", not as "valid flow".
 */
export function useFlowValidation(): ValidationResult {
  return useFlowState().validation;
}

/**
 * Live run state for the active flow. Returns the slice unchanged — the
 * canvas itself decides whether to paint, by comparing
 * `runState.flowName` against the active flow.
 */
export function useRunState(): RunState {
  return useFlowState().runState;
}

/**
 * Returns a function that opens a file picker for the given upload
 * edge and PUTs the chosen file to the controller's presigned URL.
 * Updates `runState.uploads[edge]` through `pending → uploading →
 * uploaded` (or `→ failed`).
 *
 * The hook is safe to call from any component with access to the
 * store; `DataWellNode` uses it to make upload-source wells clickable.
 */
export function useUpload(): (edge: string) => void {
  const dispatch = useFlowDispatch();
  const runState = useRunState();
  return useCallback(
    (edge: string) => {
      const entry = runState.uploads[edge];
      if (!entry) return;
      if (entry.state === 'uploading' || entry.state === 'uploaded') return;
      const input = document.createElement('input');
      input.type = 'file';
      input.onchange = async () => {
        const file = input.files?.[0];
        if (!file) return;
        dispatch({ type: 'SET_UPLOAD_STATE', edge, state: 'uploading' });
        try {
          await bff.uploadToPresignedURL(entry.putURL, file);
          dispatch({ type: 'SET_UPLOAD_STATE', edge, state: 'uploaded' });
          console.log('[run] uploaded', file.name, '→', edge);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          dispatch({
            type: 'SET_UPLOAD_STATE',
            edge,
            state: 'failed',
            errorMessage: message,
          });
          console.warn('[run] upload failed', edge, err);
        }
      };
      input.click();
    },
    [dispatch, runState.uploads],
  );
}

/** Lookup a task by `Publisher/Name` (the format used in `Step.Uses`). */
export function useTaskByUses(uses: string | undefined): Task | undefined {
  const tasks = useTasks();
  return useMemo(() => {
    if (!uses) return undefined;
    const [publisher, name] = uses.split('/');
    return tasks.find((t) => t.Publisher === publisher && t.Name === name);
  }, [tasks, uses]);
}

/** Convenience: dispatch helpers that don't require knowing the action type. */
export function useFlowActions() {
  const dispatch = useFlowDispatch();
  return useMemo(
    () => ({
      selectElement: (element: SelectedElement) => dispatch({ type: 'SELECT_ELEMENT', element }),
      selectFlow: (flowName: string) => dispatch({ type: 'SELECT_FLOW', flowName }),
      moveStep: (id: string, position: { x: number; y: number }) =>
        dispatch({ type: 'MOVE_NODE', kind: 'step', id, position }),
      moveDataWell: (id: string, position: { x: number; y: number }) =>
        dispatch({ type: 'MOVE_NODE', kind: 'datawell', id, position }),
      addStep: (step: Step, position: { x: number; y: number }) =>
        dispatch({ type: 'ADD_STEP', step, position }),
      updateStep: (id: string, patch: Partial<Step>) => dispatch({ type: 'UPDATE_STEP', id, patch }),
      renameStep: (oldID: string, newID: string) => dispatch({ type: 'RENAME_STEP', oldID, newID }),
      deleteStep: (id: string) => dispatch({ type: 'DELETE_STEP', id }),
      addDataWell: (well: DataWell, position: { x: number; y: number }) =>
        dispatch({ type: 'ADD_DATAWELL', well, position }),
      updateDataWell: (edge: string, patch: Partial<DataWell>) =>
        dispatch({ type: 'UPDATE_DATAWELL', edge, patch }),
      deleteDataWell: (edge: string) => dispatch({ type: 'DELETE_DATAWELL', edge }),
      connect: (fromStepID: string, fromPort: string, toStepID: string, toPort: string) =>
        dispatch({ type: 'CONNECT_PORTS', fromStepID, fromPort, toStepID, toPort }),
      deleteEdge: (edgeName: string) => dispatch({ type: 'DELETE_EDGE', edgeName }),
      deleteFlow: (flowName: string) => dispatch({ type: 'DELETE_FLOW', flowName }),
      updateFlowSettings: (patch: Partial<Flow>) =>
        dispatch({ type: 'UPDATE_FLOW_SETTINGS', patch }),
      hydrateFromAI: (flow: Flow, layout: CanvasLayout, newTasks: Task[]) =>
        dispatch({ type: 'HYDRATE_FROM_AI', flow, layout, newTasks }),
      setPublishStatus: (status: PublishStatus) =>
        dispatch({ type: 'PUBLISH_STATUS', status }),
      toggleYaml: (format?: BottomPanelFormat) => dispatch({ type: 'TOGGLE_YAML', format }),
      closeYaml: () => dispatch({ type: 'CLOSE_YAML' }),
      runStart: (flowName: string) => dispatch({ type: 'RUN_START', flowName }),
      runSnapshot: (run: FlowRun) => dispatch({ type: 'RUN_SNAPSHOT', run }),
      runFailed: (error: string) => dispatch({ type: 'RUN_FAILED', error }),
      runReset: () => dispatch({ type: 'RUN_RESET' }),
    }),
    [dispatch],
  );
}

/* --------------------------- Autosave ------------------------------ */
//
// Debounced persistence to BFF. Triggered whenever `state.revision`
// bumps (every mutating action), with a 600ms quiet period. The BFF
// client itself mirrors writes to localStorage as a fallback.

const AUTOSAVE_DELAY_MS = 600;

function useAutosave(state: FlowStoreState): void {
  const timer = useRef<number | null>(null);
  const lastSaved = useRef(0);

  const flush = useCallback(() => {
    if (state.status !== 'ready') return;
    if (state.revision === lastSaved.current) return;
    const target = state.revision;
    void bff
      .saveDraft(state.projectID, state.project, state.layouts, state.publishStatus)
      .then(() => {
        lastSaved.current = target;
      })
      .catch((err) => console.warn('[autosave]', err));
  }, [state.status, state.revision, state.projectID, state.project, state.layouts, state.publishStatus]);

  useEffect(() => {
    if (state.status !== 'ready') return;
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(flush, AUTOSAVE_DELAY_MS);
    return () => {
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, [state.revision, state.status, flush]);
}

/* ------------------------- Validation fetch ------------------------ */
//
// Debounced controller roundtrip. The controller is the source of
// truth for validation rules (`/api/v1/flow/validate`); we keep no
// client-side validator, so a stale or unreachable controller just
// means the editor temporarily shows no issues — that's acceptable
// since the same call gates Run/Publish at submission time.
//
// Race safety: each request gets a monotonic id. A response only
// commits if its id is still the latest, so out-of-order replies on
// rapid edits can't clobber a fresher result.

const VALIDATE_DEBOUNCE_MS = 400;

function useControllerValidation(
  state: FlowStoreState,
  dispatch: (action: FlowAction) => void,
): void {
  const timer = useRef<number | null>(null);
  const requestId = useRef(0);

  useEffect(() => {
    if (state.status !== 'ready') return;
    const flow = state.project.Flows.find((f) => f.Name === state.activeFlowName);
    if (!flow) {
      dispatch({ type: 'SET_VALIDATION', result: EMPTY_VALIDATION });
      return;
    }

    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      const id = ++requestId.current;
      void bff
        .validate(flow, state.project.Tasks)
        .then((result) => {
          if (id !== requestId.current) return;
          dispatch({ type: 'SET_VALIDATION', result });
        })
        .catch((err) => {
          if (id !== requestId.current) return;
          console.warn('[validate]', err);
        });
    }, VALIDATE_DEBOUNCE_MS);

    return () => {
      if (timer.current) window.clearTimeout(timer.current);
    };
    // `revision` bumps on every mutating action; `activeFlowName`
    // covers SELECT_FLOW (which doesn't bump revision).
  }, [state.status, state.revision, state.activeFlowName, state.project, dispatch]);
}

/* ---------------------------- Run poller --------------------------- */
//
// Polls the controller for run status updates as long as a `runID` is
// committed and the run hasn't reached a terminal phase. The effect
// keys off `runID` only (not `phase`), so polling continues across
// every snapshot dispatch — it stops naturally when `bff.pollRun`
// observes `COMPLETE`/`ERROR`. Starting a new run aborts the previous
// loop via the cleanup callback.

function useRunPoller(
  runID: string | null,
  phase: RunPhase,
  dispatch: (action: FlowAction) => void,
): void {
  useEffect(() => {
    if (!runID) return;
    if (phase === 'complete' || phase === 'error') return;
    const abort = new AbortController();
    void bff
      .pollRun(runID, (run) => dispatch({ type: 'RUN_SNAPSHOT', run }), {
        signal: abort.signal,
      })
      .catch((err) => {
        if ((err as DOMException)?.name === 'AbortError') return;
        console.warn('[run] poll failed', err);
        dispatch({
          type: 'RUN_FAILED',
          error: err instanceof Error ? err.message : String(err),
        });
      });
    return () => abort.abort();
    // `phase` is intentionally NOT in deps — we don't want to restart
    // the loop on every snapshot. The terminal-phase guard is only an
    // initial-mount optimization; `bff.pollRun` self-terminates on
    // COMPLETE/ERROR.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runID, dispatch]);
}
