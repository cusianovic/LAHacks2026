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
  Project,
  PublishStatus,
  SelectedElement,
  Step,
  Task,
} from '@/types/pupload';

import type { FlowAction } from './actions';

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
    format: 'yaml' | 'json';
  };

  /** Bumped on every mutation; the autosave effect keys off this. */
  revision: number;
}

const EMPTY_PROJECT: Project = {
  ID: DEFAULT_PROJECT_ID,
  Flows: [],
  Tasks: [],
  GlobalStores: [],
};

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
      return {
        ...state,
        status: 'ready',
        error: null,
        project,
        layouts,
        publishStatus,
        activeFlowName: state.activeFlowName || firstFlow,
        selection: { type: 'none', id: '' },
        revision: state.revision + 1,
      };
    }
    case 'PROJECT_LOAD_FAILED':
      return { ...state, status: 'error', error: action.error };

    case 'PUBLISH_STATUS':
      return { ...state, publishStatus: action.status };

    /* ----------------------- flow management --------------------- */
    case 'SELECT_FLOW':
      return {
        ...state,
        activeFlowName: action.flowName,
        selection: { type: 'none', id: '' },
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
    case 'CONNECT_PORTS': {
      const edgeName = action.edgeName ?? `${action.fromStepID}_${action.fromPort}__${action.toStepID}_${action.toPort}`;
      const project = mapActiveFlow(state, (f) => ({
        ...f,
        Steps: f.Steps.map((s) => {
          if (s.ID === action.fromStepID) {
            return {
              ...s,
              Outputs: s.Outputs.map((o) => (o.Name === action.fromPort ? { ...o, Edge: edgeName } : o)),
            };
          }
          if (s.ID === action.toStepID) {
            return {
              ...s,
              Inputs: s.Inputs.map((i) => (i.Name === action.toPort ? { ...i, Edge: edgeName } : i)),
            };
          }
          return s;
        }),
      }));
      return bump({ ...state, project });
    }

    case 'DELETE_EDGE': {
      const project = mapActiveFlow(state, (f) => ({
        ...f,
        Steps: f.Steps.map((s) => ({
          ...s,
          Inputs: s.Inputs.map((i) => (i.Edge === action.edgeName ? { ...i, Edge: '' } : i)),
          Outputs: s.Outputs.map((o) => (o.Edge === action.edgeName ? { ...o, Edge: '' } : o)),
        })),
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
      const project = mapActiveFlow(state, (f) => ({
        ...f,
        DataWells: f.DataWells.filter((w) => w.Edge !== action.edge),
      }));
      const layouts = { ...state.layouts };
      const layout = layouts[state.activeFlowName];
      if (layout) {
        const dp = { ...layout.datawellPositions };
        delete dp[action.edge];
        layouts[state.activeFlowName] = { ...layout, datawellPositions: dp };
      }
      return bump({ ...state, project, layouts });
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
  }
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
      deleteStep: (id: string) => dispatch({ type: 'DELETE_STEP', id }),
      addDataWell: (well: DataWell, position: { x: number; y: number }) =>
        dispatch({ type: 'ADD_DATAWELL', well, position }),
      updateDataWell: (edge: string, patch: Partial<DataWell>) =>
        dispatch({ type: 'UPDATE_DATAWELL', edge, patch }),
      deleteDataWell: (edge: string) => dispatch({ type: 'DELETE_DATAWELL', edge }),
      connect: (fromStepID: string, fromPort: string, toStepID: string, toPort: string) =>
        dispatch({ type: 'CONNECT_PORTS', fromStepID, fromPort, toStepID, toPort }),
      deleteEdge: (edgeName: string) => dispatch({ type: 'DELETE_EDGE', edgeName }),
      updateFlowSettings: (patch: Partial<Flow>) =>
        dispatch({ type: 'UPDATE_FLOW_SETTINGS', patch }),
      hydrateFromAI: (flow: Flow, layout: CanvasLayout, newTasks: Task[]) =>
        dispatch({ type: 'HYDRATE_FROM_AI', flow, layout, newTasks }),
      toggleYaml: (format?: 'yaml' | 'json') => dispatch({ type: 'TOGGLE_YAML', format }),
      closeYaml: () => dispatch({ type: 'CLOSE_YAML' }),
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
