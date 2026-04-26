import { useState, type RefObject } from 'react';
import clsx from 'clsx';
import { Check, Copy, Send } from 'lucide-react';

import Popover from '@/components/common/Popover';
import type { PublishResult, PublishedFlowRef } from '@/types/pupload';

// =====================================================================
// PublishResultPopover — opens after a successful Publish, anchored
// to the Publish button on the BottomBar. Surfaces the controller's
// trigger URL for each flow plus a thin recipe of the steps inside,
// so the operator can copy a runnable URL and (optionally) double-
// check what's about to fire when they curl it.
//
// The popover is non-modal — operator dismisses with click-outside,
// Escape, or by clicking the Publish button again. Re-opens on the
// next successful Publish (or by clicking the Published button after
// the result is cached on the BottomBar).
// =====================================================================

interface PublishResultPopoverProps {
  open: boolean;
  onClose: () => void;
  anchorRef: RefObject<HTMLElement | null>;
  result: PublishResult | null;
}

export default function PublishResultPopover({
  open,
  onClose,
  anchorRef,
  result,
}: PublishResultPopoverProps) {
  if (!result) return null;
  return (
    <Popover open={open} onClose={onClose} anchorRef={anchorRef} className="w-96">
      <header className="mb-2 flex items-center gap-2">
        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-accent/20 text-accent">
          <Send size={11} />
        </span>
        <h3 className="text-[12px] font-semibold leading-none text-ink">
          Published — trigger URLs
        </h3>
      </header>
      <p className="mb-3 text-[11px] leading-snug text-ink-faint">
        Run any flow by POSTing to the URL below. The controller will return
        a <code className="rounded bg-raised px-1 py-0.5 font-mono text-[10px]">FlowRun</code>{' '}
        snapshot you can poll via{' '}
        <code className="rounded bg-raised px-1 py-0.5 font-mono text-[10px]">/api/v1/flow/status/:id</code>.
      </p>

      {result.flows.length === 0 ? (
        <p className="rounded-row border border-border bg-raised/40 px-2.5 py-2 text-[11px] leading-snug text-ink-faint">
          This project has no flows yet. Add one and publish again to get a
          trigger URL.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {result.flows.map((flow) => (
            <FlowRow key={flow.name} flow={flow} />
          ))}
        </ul>
      )}
    </Popover>
  );
}

interface FlowRowProps {
  flow: PublishedFlowRef;
}

function FlowRow({ flow }: FlowRowProps) {
  return (
    <li className="rounded-row border border-border bg-raised/30 px-2.5 py-2">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className="truncate text-[12px] font-medium leading-none text-ink">
          {flow.name}
        </span>
        <span className="shrink-0 text-[10px] uppercase tracking-wide text-ink-faint">
          {flow.steps.length} {flow.steps.length === 1 ? 'step' : 'steps'}
        </span>
      </div>

      <div className="mb-2 flex items-stretch gap-1.5">
        <span className="inline-flex items-center rounded bg-accent/20 px-1.5 font-mono text-[10px] font-semibold text-accent">
          {flow.method}
        </span>
        <code className="min-w-0 flex-1 break-all rounded bg-chrome px-1.5 py-1 font-mono text-[10.5px] leading-snug text-ink">
          {flow.url}
        </code>
        <CopyButton text={flow.url} />
      </div>

      {flow.steps.length > 0 && (
        <ol className="flex flex-col gap-0.5 text-[10.5px] leading-snug text-ink-dim">
          {flow.steps.map((step, idx) => (
            <li key={step.id} className="flex items-baseline gap-1.5">
              <span className="w-3 shrink-0 text-right font-mono text-ink-faint">
                {idx + 1}.
              </span>
              <span className="truncate font-medium text-ink">{step.id}</span>
              <span className="truncate font-mono text-ink-faint">{step.uses}</span>
            </li>
          ))}
        </ol>
      )}
    </li>
  );
}

interface CopyButtonProps {
  text: string;
}

// Tiny "copy to clipboard" toggle. Falls back to noop if the Clipboard
// API isn't available (e.g. insecure context); the URL is still
// selectable in the rendered <code> block in that case.
function CopyButton({ text }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);
  const onClick = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch (err) {
      console.warn('[publish] clipboard write failed', err);
    }
  };
  return (
    <button
      type="button"
      onClick={onClick}
      title={copied ? 'Copied' : 'Copy URL'}
      className={clsx(
        'inline-flex h-7 w-7 shrink-0 items-center justify-center rounded text-ink-dim transition-colors',
        'hover:bg-raised hover:text-ink',
        copied && 'text-accent',
      )}
    >
      {copied ? <Check size={12} /> : <Copy size={12} />}
    </button>
  );
}
