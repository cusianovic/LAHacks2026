import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactFlow, {
  Background,
  BackgroundVariant,
  Controls,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
  type Edge,
  type Node,
  type NodeChange,
  type NodeDragHandler,
  type NodeMouseHandler,
  type ReactFlowInstance,
} from 'reactflow';
import { Trash2, Unlink } from 'lucide-react';

import StepNode, { type StepNodeData } from './StepNode';
import DataWellNode, { type DataWellNodeData } from './DataWellNode';
import ContextMenu, { type ContextMenuItem } from './ContextMenu';
import {
  bindInput,
  bindOutput,
  useActiveFlow,
  useFlowActions,
  useFlowState,
  useRunState,
  useTasks,
} from '@/state/flowStore';
import type { RunState } from '@/state/flowStore';
import type { DataWell, Step, StepRunStatus, Task } from '@/types/pupload';

// Right-click target identification. The `id` is the domain id
// (Step.ID / DataWell.Edge / edge name), NOT the prefixed RF id.
type ContextMenuState =
  | { kind: 'step'; id: string; x: number; y: number }
  | { kind: 'datawell'; id: string; x: number; y: number }
  | { kind: 'edge'; id: string; x: number; y: number };

// =====================================================================
// FlowCanvas — bridges the flow store ↔ React Flow's node/edge model.
//
// Source of truth: `Flow` + `CanvasLayout` in the store. React Flow's
// internal node/edge state is *derived* from those, and user-driven
// changes (drag, connect) dispatch back to the store.
//
// Key wiring points to be aware of when extending:
//
//   - Node IDs:
//       step nodes      → `step:<Step.ID>`
//       datawell nodes  → `well:<DataWell.Edge>`
//
//   - Edge IDs:
//       between two steps → `wire:<edgeName>`
//       step ↔ datawell   → `well:<edgeName>` (one of the endpoints
//                            is the datawell node, not a step).
//
// `bufferRef` keeps the dragged-but-not-yet-committed positions so we
// only push to the store on drag stop (debounced through revisions).
// =====================================================================

export default function FlowCanvas() {
  return (
    <ReactFlowProvider>
      <FlowCanvasInner />
    </ReactFlowProvider>
  );
}

function FlowCanvasInner() {
  const tasks = useTasks();
  const flow = useActiveFlow();
  const { layouts, activeFlowName, selection } = useFlowState();
  const runState = useRunState();
  const actions = useFlowActions();
  const layout = layouts[activeFlowName];
  const rfRef = useRef<ReactFlowInstance | null>(null);
  const { fitView } = useReactFlow();

  // Run decoration is gated on the active flow matching the run's
  // flow — swapping to a different flow during a run hides the
  // animation here without resetting the run itself.
  const activeRun =
    runState.flowName === activeFlowName && runState.phase !== 'idle'
      ? runState
      : null;

  /* -------- derive RF nodes from store -------- */
  const initialNodes = useMemo(
    () => buildNodes(flow, layout, tasks, selection, activeRun),
    [flow, layout, tasks, selection, activeRun],
  );
  const initialEdges = useMemo(() => buildEdges(flow), [flow]);

  const [rfNodes, setRfNodes, onNodesChange] = useNodesState(initialNodes);
  const [rfEdges, setRfEdges, onEdgesChange] = useEdgesState(initialEdges);

  // ── Two-effect sync, by design ──────────────────────────────────────
  //
  // Earlier this used a single signature that included `selected`, which
  // meant a CLICK changed the signature and triggered a full node reset.
  // If a node had been dragged but the store hadn't caught up (or the
  // position commit was missed), the reset would snap nodes back to
  // their `addStep`-time fallback positions.
  //
  // Now we split the sync:
  //   1. `structuralSignature` excludes `selected` and `data` mutability
  //      that doesn't affect layout. It triggers a full setRfNodes only
  //      when positions or node identity change.
  //   2. A second effect surgically updates only the `selected` flag in
  //      place — never touching positions.
  //
  // If you change the shape of the data passed to nodes, make sure the
  // pieces that *should* trigger a re-sync are included in `structuralSignature`.
  // The signature includes node `data` so per-node status/upload
  // changes (which arrive on every poll tick) propagate to React
  // Flow's internal node array. Selection alone does NOT bump this
  // — it's handled by the surgical second effect below.
  const structuralSignature = useMemo(
    () =>
      JSON.stringify(
        initialNodes.map((n) => ({
          id: n.id,
          p: n.position,
          t: n.type,
          d: nodeDataDigest(n.data),
        })),
      ),
    [initialNodes],
  );
  const edgesSignature = useMemo(
    () => JSON.stringify(initialEdges.map((e) => ({ id: e.id, s: e.source, t: e.target, sh: e.sourceHandle, th: e.targetHandle }))),
    [initialEdges],
  );

  // Effect 1 — full sync on structural change (positions, add/remove).
  useEffect(() => {
    setRfNodes(initialNodes);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally keyed on signature
  }, [structuralSignature]);

  // Effect 2 — selection-only update. Preserves RF's current positions.
  useEffect(() => {
    setRfNodes((current) =>
      current.map((n) => {
        const want =
          (n.id.startsWith('step:') && selection.type === 'step' && selection.id === n.id.slice(5)) ||
          (n.id.startsWith('well:') && selection.type === 'datawell' && selection.id === n.id.slice(5));
        return n.selected === want ? n : { ...n, selected: want };
      }),
    );
  }, [selection, setRfNodes]);

  useEffect(() => {
    setRfEdges(initialEdges);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally keyed on signature
  }, [edgesSignature]);

  /* -------- handlers -------- */
  // We forward all changes verbatim. Position commits happen in
  // `handleNodeDragStop` below — relying on `c.dragging === false` was
  // unreliable (RF sometimes leaves it `undefined` on the final event,
  // which silently dropped the position update).
  const handleNodesChange = useCallback(
    (changes: NodeChange[]) => {
      onNodesChange(changes);
    },
    [onNodesChange],
  );

  const handleNodeDragStop: NodeDragHandler = useCallback(
    (_e, node) => {
      if (node.id.startsWith('step:')) {
        actions.moveStep(node.id.slice(5), node.position);
      } else if (node.id.startsWith('well:')) {
        actions.moveDataWell(node.id.slice(5), node.position);
      }
    },
    [actions],
  );

  const handleConnect = useCallback(
    (conn: Connection) => {
      if (!conn.source || !conn.target || !flow) return;
      const fromIsStep = conn.source.startsWith('step:');
      const toIsStep = conn.target.startsWith('step:');
      const fromIsWell = conn.source.startsWith('well:');
      const toIsWell = conn.target.startsWith('well:');

      // ── Case 1: step → step (standard wire) ─────────────────────────
      if (fromIsStep && toIsStep && conn.sourceHandle && conn.targetHandle) {
        actions.connect(
          conn.source.slice(5),
          conn.sourceHandle,
          conn.target.slice(5),
          conn.targetHandle,
        );
        return;
      }

      // ── Case 2: well → step input ───────────────────────────────────
      // The well feeds data INTO the step. Bind the step input's `Edge`
      // field to the well's edge name; `buildEdges` will then render
      // the dashed wire on the next pass.
      if (fromIsWell && toIsStep && conn.targetHandle) {
        const wellEdge = conn.source.slice(5);
        const stepID = conn.target.slice(5);
        bindStepPort(flow, stepID, 'Inputs', conn.targetHandle, wellEdge, actions.updateStep);
        return;
      }

      // ── Case 3: step output → well ──────────────────────────────────
      // The step writes results INTO the well. Bind the step output's
      // `Edge` to the well's edge name.
      if (fromIsStep && toIsWell && conn.sourceHandle) {
        const stepID = conn.source.slice(5);
        const wellEdge = conn.target.slice(5);
        bindStepPort(flow, stepID, 'Outputs', conn.sourceHandle, wellEdge, actions.updateStep);
        return;
      }

      // Anything else (e.g. well → well) is meaningless; drop silently.
    },
    [actions, flow],
  );

  /* -------- right-click context menu -------- */
  // A single state slot drives the menu; null means hidden.
  // Declared above the click handlers so they can dismiss the menu
  // synchronously without relying on ContextMenu's window mousedown
  // listener firing first.
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const closeContextMenu = useCallback(() => setContextMenu(null), []);

  // Every left-click that lands on a React Flow surface (pane, node,
  // edge) dismisses any open right-click menu. Explicit closure here is
  // belt-and-suspenders alongside ContextMenu's own window mousedown
  // listener — pointer-event handling inside React Flow can swallow the
  // native mousedown bubble in edge cases, so we don't trust it alone.
  const handleNodeClick: NodeMouseHandler = useCallback(
    (_e, node) => {
      setContextMenu(null);
      if (node.id.startsWith('step:')) {
        actions.selectElement({ type: 'step', id: node.id.slice(5) });
      } else if (node.id.startsWith('well:')) {
        actions.selectElement({ type: 'datawell', id: node.id.slice(5) });
      }
    },
    [actions],
  );

  const handleEdgeClick = useCallback(
    (_e: React.MouseEvent, edge: Edge) => {
      setContextMenu(null);
      // Edge id: "wire:<name>" or "well:<name>"
      const name = edge.id.split(':')[1] ?? edge.id;
      actions.selectElement({ type: 'edge', id: name });
    },
    [actions],
  );

  const handlePaneClick = useCallback(() => {
    setContextMenu(null);
    actions.selectElement({ type: 'none', id: '' });
  }, [actions]);

  const handleNodeContextMenu: NodeMouseHandler = useCallback((event, node) => {
    event.preventDefault();
    if (node.id.startsWith('step:')) {
      setContextMenu({ kind: 'step', id: node.id.slice(5), x: event.clientX, y: event.clientY });
    } else if (node.id.startsWith('well:')) {
      setContextMenu({ kind: 'datawell', id: node.id.slice(5), x: event.clientX, y: event.clientY });
    }
  }, []);

  const handleEdgeContextMenu = useCallback(
    (event: React.MouseEvent, edge: Edge) => {
      event.preventDefault();
      const name = edge.id.split(':')[1] ?? edge.id;
      setContextMenu({ kind: 'edge', id: name, x: event.clientX, y: event.clientY });
    },
    [],
  );

  // Right-clicking empty pane clears any open menu (and suppresses the
  // browser's default menu, leaving room for a future "insert here" UX).
  const handlePaneContextMenu = useCallback((event: React.MouseEvent | MouseEvent) => {
    event.preventDefault();
    setContextMenu(null);
  }, []);

  // Build the items for the currently-open menu. Kept inline so the
  // store actions are captured by closure without an extra useCallback.
  const menuItems: ContextMenuItem[] = useMemo(() => {
    if (!contextMenu) return [];
    switch (contextMenu.kind) {
      case 'step':
        return [
          {
            label: 'Delete step',
            icon: <Trash2 size={13} />,
            onClick: () => actions.deleteStep(contextMenu.id),
            danger: true,
          },
        ];
      case 'datawell':
        return [
          {
            label: 'Delete data well',
            icon: <Trash2 size={13} />,
            onClick: () => actions.deleteDataWell(contextMenu.id),
            danger: true,
          },
        ];
      case 'edge':
        return [
          {
            label: 'Disconnect',
            icon: <Unlink size={13} />,
            onClick: () => actions.deleteEdge(contextMenu.id),
            danger: true,
          },
        ];
    }
  }, [contextMenu, actions]);

  /* -------- empty state -------- */
  if (!flow) {
    return (
      <div className="flex h-full items-center justify-center text-center">
        <div>
          <p className="text-sm text-ink-dim">No flow selected</p>
          <p className="mt-1 text-xs text-ink-faint">Create a flow from the left sidebar.</p>
        </div>
      </div>
    );
  }
  if (flow.Steps.length === 0 && flow.DataWells.length === 0) {
    return (
      <div className="relative h-full w-full">
        <ReactFlow
          nodes={[]}
          edges={[]}
          onInit={(inst) => {
            rfRef.current = inst;
          }}
          fitView
          panOnScroll
          panOnDrag
          minZoom={0.25}
          maxZoom={2}
          proOptions={{ hideAttribution: true }}
        >
          <Background variant={BackgroundVariant.Dots} gap={18} size={1} color="rgba(0,0,0,0.18)" />
        </ReactFlow>
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="rounded-row border border-border bg-chrome/90 px-5 py-4 text-center backdrop-blur">
            <p className="text-sm text-ink">This flow is empty.</p>
            <p className="mt-1 text-xs text-ink-dim">
              Use <span className="font-mono">Add Step</span> or{' '}
              <span className="font-mono">AI Generate</span> to get started.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full w-full">
      <ReactFlow
        nodes={rfNodes}
        edges={rfEdges}
        nodeTypes={NODE_TYPES}
        onInit={(inst) => {
          rfRef.current = inst;
          // Defer so layout settles, then frame the content.
          setTimeout(() => fitView({ padding: 0.2, duration: 200 }), 50);
        }}
        onNodesChange={handleNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeDragStop={handleNodeDragStop}
        onConnect={handleConnect}
        onNodeClick={handleNodeClick}
        onEdgeClick={handleEdgeClick}
        onPaneClick={handlePaneClick}
        onNodeContextMenu={handleNodeContextMenu}
        onEdgeContextMenu={handleEdgeContextMenu}
        onPaneContextMenu={handlePaneContextMenu}
        fitView
        minZoom={0.25}
        maxZoom={2}
        snapToGrid
        snapGrid={[16, 16]}
        defaultEdgeOptions={{ type: 'smoothstep' }}
        connectionLineStyle={{ strokeWidth: 2 }}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={18} size={1} color="rgba(0,0,0,0.18)" />
        <Controls position="bottom-left" showInteractive={false} />
      </ReactFlow>
      {contextMenu ? (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={menuItems}
          onClose={closeContextMenu}
        />
      ) : null}
    </div>
  );
}

const NODE_TYPES = {
  step: StepNode,
  datawell: DataWellNode,
};

/* -------------------- store → React Flow mappers ------------------- */

function buildNodes(
  flow: ReturnType<typeof useActiveFlow>,
  layout: ReturnType<typeof useFlowState>['layouts'][string] | undefined,
  tasks: Task[],
  selection: ReturnType<typeof useFlowState>['selection'],
  run: RunState | null,
): Node[] {
  if (!flow) return [];
  const nodes: Node[] = [];

  flow.Steps.forEach((step, i) => {
    const task = findTask(tasks, step.Uses);
    const pos = layout?.nodePositions[step.ID] ?? { x: 80 + i * 280, y: 120 };
    const status: StepRunStatus = run?.stepStatuses[step.ID] ?? 'IDLE';
    const data: StepNodeData = { step, task, status };
    nodes.push({
      id: `step:${step.ID}`,
      type: 'step',
      position: pos,
      data,
      selected: selection.type === 'step' && selection.id === step.ID,
    });
  });

  flow.DataWells.forEach((well, i) => {
    const direction = inferWellDirection(flow, well);
    const pos = layout?.datawellPositions[well.Edge] ?? { x: 80, y: 320 + i * 70 };
    const upload = run?.uploads[well.Edge];
    const data: DataWellNodeData = { well, direction, upload };
    nodes.push({
      id: `well:${well.Edge}`,
      type: 'datawell',
      position: pos,
      data,
      selected: selection.type === 'datawell' && selection.id === well.Edge,
    });
  });

  return nodes;
}

// nodeDataDigest extracts only the run-state-driven fields from a
// node's `data` payload, so the structural signature flips whenever
// per-node status changes without including unrelated mutable fields
// (the `step`/`well` references change on every reducer tick because
// of `mapActiveFlow`'s spread — a verbatim JSON.stringify would mark
// every keystroke as structural). Keep this in sync with the
// `*NodeData` shapes above.
function nodeDataDigest(data: unknown): string {
  if (!data || typeof data !== 'object') return '';
  const d = data as Partial<StepNodeData> & Partial<DataWellNodeData>;
  if (d.status) return `s:${d.status}`;
  if (d.upload) return `u:${d.upload.state}`;
  return '';
}

function buildEdges(flow: ReturnType<typeof useActiveFlow>): Edge[] {
  if (!flow) return [];
  const edges: Edge[] = [];
  const wireSeen = new Set<string>();

  // Pair steps by edge name: an Output's Edge that matches another Step's Input.Edge.
  flow.Steps.forEach((src) => {
    src.Outputs.forEach((out) => {
      if (!out.Edge) return;
      const consumers = flow.Steps.filter((s) =>
        s.Inputs.some((i) => i.Edge === out.Edge),
      );
      consumers.forEach((dst) => {
        const inPort = dst.Inputs.find((i) => i.Edge === out.Edge);
        if (!inPort) return;
        const id = `wire:${out.Edge}:${src.ID}->${dst.ID}:${inPort.Name}`;
        if (wireSeen.has(id)) return;
        wireSeen.add(id);
        edges.push({
          id,
          source: `step:${src.ID}`,
          sourceHandle: out.Name,
          target: `step:${dst.ID}`,
          targetHandle: inPort.Name,
          type: 'smoothstep',
          label: out.Edge,
          labelStyle: { fill: '#9aa0ad', fontSize: 10, fontFamily: 'JetBrains Mono Variable, monospace' },
          labelBgStyle: { fill: '#11141b' },
          labelBgPadding: [4, 2],
        });
      });
    });
  });

  // Datawell connections: render visual edges between wells and the
  // step ports that share the same edge name.
  flow.DataWells.forEach((well) => {
    flow.Steps.forEach((step) => {
      step.Inputs.forEach((inp) => {
        if (inp.Edge === well.Edge) {
          edges.push({
            id: `well:${well.Edge}->${step.ID}:${inp.Name}`,
            source: `well:${well.Edge}`,
            sourceHandle: well.Edge,
            target: `step:${step.ID}`,
            targetHandle: inp.Name,
            type: 'smoothstep',
            style: { strokeDasharray: '4 4' },
          });
        }
      });
      step.Outputs.forEach((out) => {
        if (out.Edge === well.Edge) {
          edges.push({
            id: `well:${step.ID}:${out.Name}->${well.Edge}`,
            source: `step:${step.ID}`,
            sourceHandle: out.Name,
            target: `well:${well.Edge}`,
            targetHandle: well.Edge,
            type: 'smoothstep',
            style: { strokeDasharray: '4 4' },
          });
        }
      });
    });
  });

  return edges;
}

function findTask(tasks: Task[], uses: string): Task | undefined {
  const [pub, name] = uses.split('/');
  return tasks.find((t) => t.Publisher === pub && t.Name === name);
}

// Binds a single step port to an edge and dispatches an UPDATE_STEP
// patch. Both sides delegate to the shared `bindInput` / `bindOutput`
// helpers in the store, which enforce the 1:1 rule (one entry per
// port `Name`) — fan-out happens by *sharing* edge names across
// inputs, not by stacking entries on the output. This indirection
// exists so well↔step wiring uses exactly the same code path as the
// inspector form.
function bindStepPort(
  flow: NonNullable<ReturnType<typeof useActiveFlow>>,
  stepID: string,
  side: 'Inputs' | 'Outputs',
  portName: string,
  edgeName: string,
  updateStep: (id: string, patch: Partial<Step>) => void,
) {
  const step = flow.Steps.find((s) => s.ID === stepID);
  if (!step) return;
  const next =
    side === 'Inputs'
      ? bindInput(step.Inputs, portName, edgeName)
      : bindOutput(step.Outputs, portName, edgeName);
  updateStep(stepID, { [side]: next } as Partial<Step>);
}

function inferWellDirection(flow: NonNullable<ReturnType<typeof useActiveFlow>>, well: DataWell): 'source' | 'sink' {
  const consumed = flow.Steps.some((s) => s.Inputs.some((i) => i.Edge === well.Edge));
  const produced = flow.Steps.some((s) => s.Outputs.some((o) => o.Edge === well.Edge));
  if (consumed && !produced) return 'source';
  if (produced && !consumed) return 'sink';
  // default: treat upload/webhook as source, anything else as sink
  if (well.Source === 'upload' || well.Source === 'webhook') return 'source';
  return 'sink';
}

// Keep linter happy: reference to suppress unused warnings if direction helper grows.
// (no-op)
export type { Step };
