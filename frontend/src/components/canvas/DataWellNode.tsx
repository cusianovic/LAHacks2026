import { memo, useCallback } from 'react';
import { Handle, Position, type NodeProps } from 'reactflow';
import clsx from 'clsx';
import { Upload, Loader2, Check, AlertCircle } from 'lucide-react';

import { useUpload } from '@/state/flowStore';
import type { UploadEntry } from '@/state/flowStore';
import type { DataWell, DataWellSource } from '@/types/pupload';

// =====================================================================
// DataWellNode — pill-shaped node for sources/sinks.
//
// Color-coded by source type. A well can act as input (sink) or output
// (source) — direction is set via `data.direction` so we know which
// handle to render.
//
// During a run, an upload-source well that the controller is waiting
// on becomes a clickable target: the user picks a file in their OS
// dialog, the node PUTs it to the controller's presigned URL, and the
// pill cycles through pending → uploading → uploaded states. See
// `useUpload` in the store for the upload mechanics; the node itself
// is purely presentational.
// =====================================================================

export interface DataWellNodeData {
  well: DataWell;
  /** "source" → has output handle (right). "sink" → has input handle (left). */
  direction: 'source' | 'sink';
  /**
   * Live upload state for this well's edge, threaded in by
   * `FlowCanvas.buildNodes`. Undefined when not part of an active run
   * or when the well isn't `Source="upload"`.
   */
  upload?: UploadEntry;
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
  const { well, direction, upload } = data;
  const tint = SOURCE_TINT[well.Source ?? 'default'];
  const triggerUpload = useUpload();

  // Only `Source="upload"` wells are clickable; the controller never
  // hands us a presigned URL for `static`/`webhook` so `upload` will
  // be undefined for those even mid-run.
  const isClickable = upload?.state === 'pending' || upload?.state === 'failed';

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      if (!isClickable) return;
      // React Flow's pane click selection still fires through node
      // clicks; we let it (so the inspector can show the well too).
      e.stopPropagation();
      triggerUpload(well.Edge);
    },
    [isClickable, triggerUpload, well.Edge],
  );

  return (
    <div
      role={isClickable ? 'button' : undefined}
      tabIndex={isClickable ? 0 : undefined}
      onClick={handleClick}
      onKeyDown={
        isClickable
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                triggerUpload(well.Edge);
              }
            }
          : undefined
      }
      className={clsx(
        'relative flex h-10 min-w-[160px] items-center gap-2 rounded-pill border px-3 shadow-pill transition-all',
        tint,
        // Selection ring takes precedence; otherwise show the upload
        // affordance via border + glow.
        selected
          ? 'border-accent ring-1 ring-accent'
          : upload?.state === 'pending'
            ? 'border-accent/70 ring-1 ring-accent/40 animate-pulse-ring cursor-pointer'
            : upload?.state === 'uploading'
              ? 'border-status-running/80 cursor-wait'
              : upload?.state === 'uploaded'
                ? 'border-status-complete/70'
                : upload?.state === 'failed'
                  ? 'border-status-error/80 cursor-pointer'
                  : 'border-border hover:border-ink-faint',
      )}
      title={uploadTitle(upload)}
    >
      <span className="font-mono text-[10px] uppercase tracking-wider text-ink-faint">
        {well.Source ?? 'none'}
      </span>
      <span className="font-mono text-[12px] text-ink">{well.Edge}</span>
      <UploadBadge upload={upload} />
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

/* --------------------------- sub-components ------------------------ */

// UploadBadge surfaces the current upload lifecycle as an inline icon
// + label. Stays out of the way (no badge) when the well isn't part
// of an active run.
function UploadBadge({ upload }: { upload?: UploadEntry }) {
  if (!upload) return null;
  switch (upload.state) {
    case 'pending':
      return (
        <span className="inline-flex items-center gap-1 rounded-row bg-accent/15 px-1.5 py-0.5 text-[10px] font-medium text-accent">
          <Upload size={10} />
          Click to upload
        </span>
      );
    case 'uploading':
      return (
        <span className="inline-flex items-center gap-1 rounded-row bg-status-running/15 px-1.5 py-0.5 text-[10px] font-medium text-status-running">
          <Loader2 size={10} className="animate-spin" />
          Uploading…
        </span>
      );
    case 'uploaded':
      return (
        <span className="inline-flex items-center gap-1 rounded-row bg-status-complete/15 px-1.5 py-0.5 text-[10px] font-medium text-status-complete">
          <Check size={10} />
          Uploaded
        </span>
      );
    case 'failed':
      return (
        <span className="inline-flex items-center gap-1 rounded-row bg-status-error/15 px-1.5 py-0.5 text-[10px] font-medium text-status-error">
          <AlertCircle size={10} />
          Retry
        </span>
      );
  }
}

function uploadTitle(upload: UploadEntry | undefined): string | undefined {
  if (!upload) return undefined;
  switch (upload.state) {
    case 'pending':
      return 'Click to choose a file for this datawell';
    case 'uploading':
      return 'Uploading…';
    case 'uploaded':
      return 'Uploaded';
    case 'failed':
      return upload.errorMessage ?? 'Upload failed — click to retry';
  }
}
