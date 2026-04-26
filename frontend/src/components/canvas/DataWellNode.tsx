import { memo } from 'react';
import { Handle, Position, type NodeProps } from 'reactflow';
import clsx from 'clsx';

import type { DataWell, DataWellSource } from '@/types/pupload';

// =====================================================================
// DataWellNode — pill-shaped node for sources/sinks.
//
// Color-coded by source type. A well can act as input (sink) or output
// (source) — direction is set via `data.direction` so we know which
// handle to render.
// =====================================================================

export interface DataWellNodeData {
  well: DataWell;
  /** "source" → has output handle (right). "sink" → has input handle (left). */
  direction: 'source' | 'sink';
}

// All source types share the same surface treatment now (dark pill on
// light canvas). To re-introduce per-source color, swap the matching
// entry below for a `bg-*`/`text-*` class set.
const SOURCE_TINT: Record<DataWellSource | 'default', string> = {
  upload: 'bg-chrome',
  static: 'bg-chrome',
  webhook: 'bg-chrome',
  default: 'bg-chrome',
};

function DataWellNode({ data, selected }: NodeProps<DataWellNodeData>) {
  const { well, direction } = data;
  const tint = SOURCE_TINT[well.Source ?? 'default'];

  return (
    <div
      className={clsx(
        'relative flex h-10 min-w-[160px] items-center gap-2 rounded-pill border px-3 shadow-pill transition-shadow',
        tint,
        selected
          ? 'border-accent ring-1 ring-accent'
          : 'border-border hover:border-ink-faint',
      )}
    >
      <span className="font-mono text-[10px] uppercase tracking-wider text-ink-faint">
        {well.Source ?? 'none'}
      </span>
      <span className="font-mono text-[12px] text-ink">{well.Edge}</span>
      <span className="ml-auto font-mono text-[10px] text-ink-faint">@{well.Store || '—'}</span>

      {direction === 'sink' ? (
        <Handle id={well.Edge} type="target" position={Position.Left} />
      ) : (
        <Handle id={well.Edge} type="source" position={Position.Right} />
      )}
    </div>
  );
}

export default memo(DataWellNode);
