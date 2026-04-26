// =====================================================================
// FlowStore actions — every mutation that can happen to the editor.
//
// Adding a new feature?
//   1. Define a new action variant in `FlowAction` below.
//   2. Handle it in `flowStore.tsx`'s reducer.
//   3. Dispatch from a component via `useFlowDispatch()`.
//
// This file is the inventory of "things the user can do" — keep it the
// only place new variants get added so the reducer stays exhaustive.
// =====================================================================

import type {
  CanvasLayout,
  DataWell,
  EnrichedProject,
  Flow,
  PublishStatus,
  SelectedElement,
  Step,
  StoreInput,
  Task,
  XY,
} from '@/types/pupload';

export type FlowAction =
  /* lifecycle */
  | { type: 'PROJECT_LOADED'; payload: EnrichedProject }
  | { type: 'PROJECT_LOAD_FAILED'; error: string }
  | { type: 'PUBLISH_STATUS'; status: PublishStatus }

  /* flow selection / management */
  | { type: 'SELECT_FLOW'; flowName: string }
  | { type: 'CREATE_FLOW'; flow: Flow }
  | { type: 'RENAME_FLOW'; oldName: string; newName: string }
  | { type: 'DELETE_FLOW'; flowName: string }
  | { type: 'UPDATE_FLOW_SETTINGS'; patch: Partial<Flow> }

  /* canvas selection */
  | { type: 'SELECT_ELEMENT'; element: SelectedElement }

  /* steps */
  | { type: 'ADD_STEP'; step: Step; position: XY }
  | { type: 'UPDATE_STEP'; id: string; patch: Partial<Step> }
  | { type: 'DELETE_STEP'; id: string }

  /* nodes & layout */
  | { type: 'MOVE_NODE'; kind: 'step' | 'datawell'; id: string; position: XY }
  | { type: 'SET_VIEWPORT'; zoom: number; offset: XY }

  /* edges */
  | { type: 'CONNECT_PORTS'; fromStepID: string; fromPort: string; toStepID: string; toPort: string; edgeName?: string }
  | { type: 'DELETE_EDGE'; edgeName: string }

  /* datawells */
  | { type: 'ADD_DATAWELL'; well: DataWell; position: XY }
  | { type: 'UPDATE_DATAWELL'; edge: string; patch: Partial<DataWell> }
  | { type: 'DELETE_DATAWELL'; edge: string }

  /* stores */
  | { type: 'UPSERT_STORE'; store: StoreInput }
  | { type: 'DELETE_STORE'; name: string }

  /* tasks (project-scoped) */
  | { type: 'ADD_TASK'; task: Task }
  | { type: 'SET_TASKS'; tasks: Task[] }

  /* ai hydration */
  | { type: 'HYDRATE_FROM_AI'; flow: Flow; layout: CanvasLayout; newTasks: Task[] }

  /* yaml panel */
  | { type: 'TOGGLE_YAML'; format?: 'yaml' | 'json' }
  | { type: 'CLOSE_YAML' };
