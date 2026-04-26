// =====================================================================
// Auto-layout — topological sort + simple grid placement.
//
// Used after AI generation (and optionally on user request) to produce
// a readable left-to-right layout for a Flow without persisted positions.
//
// This is intentionally simple. Replace with dagre / elk / a custom
// algorithm if you outgrow it — the only contract is:
//
//     autoLayout(flow) → CanvasLayout
//
// Components don't care how the positions were chosen.
// TODO(wire): swap for dagre once layouts get noisy.
// =====================================================================

import type { CanvasLayout, Flow, XY } from '@/types/pupload';

const COL_WIDTH = 280;
const ROW_HEIGHT = 140;
const ORIGIN: XY = { x: 80, y: 120 };

export function autoLayout(flow: Flow): CanvasLayout {
  // Build adjacency from edge wires: for each Step.Output → connected Step.Input.
  const stepByID = new Map(flow.Steps.map((s) => [s.ID, s]));
  const outgoingEdgeNames = new Map<string, string[]>(); // stepID → edge names emitted
  const incomingEdgeNames = new Map<string, string[]>(); // stepID → edge names consumed
  flow.Steps.forEach((s) => {
    outgoingEdgeNames.set(s.ID, s.Outputs.map((o) => o.Edge));
    incomingEdgeNames.set(s.ID, s.Inputs.map((i) => i.Edge));
  });

  // Map edge name → producing step.
  const producerByEdge = new Map<string, string>();
  flow.Steps.forEach((s) => {
    s.Outputs.forEach((o) => producerByEdge.set(o.Edge, s.ID));
  });

  // Compute step depth (longest path from any source).
  const depth = new Map<string, number>();
  const visit = (id: string, stack: Set<string>): number => {
    if (depth.has(id)) return depth.get(id)!;
    if (stack.has(id)) return 0; // cycle guard
    stack.add(id);
    const incoming = incomingEdgeNames.get(id) ?? [];
    let d = 0;
    for (const edgeName of incoming) {
      const producer = producerByEdge.get(edgeName);
      if (!producer || !stepByID.has(producer)) continue;
      d = Math.max(d, visit(producer, stack) + 1);
    }
    stack.delete(id);
    depth.set(id, d);
    return d;
  };
  flow.Steps.forEach((s) => visit(s.ID, new Set()));

  // Group steps by column (depth), assign rows in stable order.
  const columns = new Map<number, string[]>();
  flow.Steps.forEach((s) => {
    const d = depth.get(s.ID) ?? 0;
    if (!columns.has(d)) columns.set(d, []);
    columns.get(d)!.push(s.ID);
  });

  const nodePositions: Record<string, XY> = {};
  for (const [col, ids] of columns) {
    ids.forEach((id, row) => {
      nodePositions[id] = {
        x: ORIGIN.x + col * COL_WIDTH,
        y: ORIGIN.y + row * ROW_HEIGHT,
      };
    });
  }

  // Place datawells: source-style wells on the far left, sinks on the far right.
  // We don't know direction definitively, so heuristically place by whether
  // the well's edge is consumed (input) or produced (output) on a step.
  const datawellPositions: Record<string, XY> = {};
  const maxCol = Math.max(0, ...Array.from(columns.keys()));
  const wells = flow.DataWells ?? [];
  let leftRow = 0;
  let rightRow = 0;
  wells.forEach((w) => {
    const consumedByStep = flow.Steps.some((s) => s.Inputs.some((i) => i.Edge === w.Edge));
    const producedByStep = flow.Steps.some((s) => s.Outputs.some((o) => o.Edge === w.Edge));
    if (consumedByStep && !producedByStep) {
      datawellPositions[w.Edge] = {
        x: ORIGIN.x - COL_WIDTH,
        y: ORIGIN.y + leftRow * ROW_HEIGHT,
      };
      leftRow += 1;
    } else {
      datawellPositions[w.Edge] = {
        x: ORIGIN.x + (maxCol + 1) * COL_WIDTH,
        y: ORIGIN.y + rightRow * ROW_HEIGHT,
      };
      rightRow += 1;
    }
  });

  return {
    flowName: flow.Name,
    nodePositions,
    datawellPositions,
    zoom: 1,
    offset: { x: 0, y: 0 },
  };
}

/** Merge user-edited positions into a freshly auto-laid-out layout, preserving manual placements. */
export function mergeLayouts(base: CanvasLayout, override?: CanvasLayout): CanvasLayout {
  if (!override) return base;
  return {
    flowName: base.flowName,
    nodePositions: { ...base.nodePositions, ...override.nodePositions },
    datawellPositions: { ...base.datawellPositions, ...override.datawellPositions },
    zoom: override.zoom ?? base.zoom,
    offset: override.offset ?? base.offset,
  };
}
