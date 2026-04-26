import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Copy, X } from 'lucide-react';
import clsx from 'clsx';

import { useActiveFlow, useFlowActions, useFlowState, useFlowValidation } from '@/state/flowStore';
import { flowToJSON, flowToYAML, redactSecrets } from '@/lib/yaml';
import ResizeHandle, { useResizable } from '@/components/common/ResizeHandle';
import IssuesPanel from './IssuesPanel';

// =====================================================================
// YamlPanel — slide-up multi-format panel at the bottom of the canvas.
// Despite the name, it now hosts three tabs: YAML, JSON, and Issues
// (the latest controller-side validation result). Body switches by
// `yamlPanel.format`. The Copy action is hidden on the Issues tab
// since it isn't a textual export.
//
// Resizing: the drawer's height is owned by `useResizable` (axis 'y',
// inverted because the handle on the TOP edge means dragging upward
// grows the drawer). Max is recomputed on window resize so the drawer
// can never push the floating toolbar / canvas content off-screen.
// =====================================================================

const HEIGHT_DEFAULT = 360;
const HEIGHT_MIN = 160;
// Percentage of viewport height the drawer is allowed to occupy.
// 0.85 leaves a 15% strip of canvas + toolbar visible above the drawer
// even when it's pulled to the top.
const HEIGHT_MAX_FRACTION = 0.85;

export default function YamlPanel() {
  const flow = useActiveFlow();
  const { yamlPanel } = useFlowState();
  const actions = useFlowActions();
  const { Errors, Warnings } = useFlowValidation();
  const [copied, setCopied] = useState(false);

  // Recompute the upper bound when the viewport changes so a saved
  // px-based height never grows past the screen on a smaller window.
  const [maxHeight, setMaxHeight] = useState(() =>
    typeof window === 'undefined'
      ? HEIGHT_DEFAULT * 2
      : Math.max(HEIGHT_MIN + 1, Math.floor(window.innerHeight * HEIGHT_MAX_FRACTION)),
  );
  useEffect(() => {
    const onResize = () =>
      setMaxHeight(Math.max(HEIGHT_MIN + 1, Math.floor(window.innerHeight * HEIGHT_MAX_FRACTION)));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const drawer = useResizable({
    initial: HEIGHT_DEFAULT,
    min: HEIGHT_MIN,
    max: maxHeight,
    axis: 'y',
    // Handle sits on the TOP edge — pulling the pointer UP (negative
    // dy) should grow the drawer.
    invert: true,
    storageKey: 'bottom-yaml',
  });

  const text = useMemo(() => {
    if (!flow) return '';
    if (yamlPanel.format === 'issues') return '';
    // Redact credential-style Store params before serialising. The
    // mask is purely cosmetic for this preview pane — the actual save
    // payload still carries the real values. See `lib/yaml.ts`.
    const safe = redactSecrets(flow);
    return yamlPanel.format === 'json' ? flowToJSON(safe) : flowToYAML(safe);
  }, [flow, yamlPanel.format]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked */
    }
  };

  const isIssues = yamlPanel.format === 'issues';
  const issueCount = Errors.length + Warnings.length;

  // Slides up from the bottom of the canvas. Edges are flush with the
  // sidebars; only the top edge has a hairline border so the panel
  // reads as a drawer rising from the floor. The floating pill (z-30)
  // hovers above with `backdrop-blur` to keep content readable.
  //
  // `relative` is required so the absolutely-positioned ResizeHandle
  // anchors to the drawer's top edge instead of the page.
  return (
    <div
      className="absolute inset-x-0 bottom-0 z-20 border-t border-border bg-chrome shadow-pill"
      style={{ height: drawer.size }}
    >
      <ResizeHandle side="top" onPointerDown={drawer.onPointerDown} active={drawer.dragging} />
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <div className="flex items-center gap-1">
          <FormatTab label="YAML" active={yamlPanel.format === 'yaml'} onClick={() => actions.toggleYaml('yaml')} />
          <FormatTab label="JSON" active={yamlPanel.format === 'json'} onClick={() => actions.toggleYaml('json')} />
          <FormatTab
            label="Issues"
            active={isIssues}
            onClick={() => actions.toggleYaml('issues')}
            badge={issueCount > 0 ? <CountBadge errors={Errors.length} warnings={Warnings.length} /> : null}
          />
        </div>
        <div className="flex items-center gap-1">
          {!isIssues ? (
            <>
              <button
                type="button"
                onClick={handleCopy}
                className="rounded-row p-1.5 text-ink-dim hover:bg-raised hover:text-ink"
                aria-label="Copy"
              >
                <Copy size={14} />
              </button>
              {copied ? <span className="text-[10px] text-status-saved">Copied</span> : null}
            </>
          ) : null}
          <button
            type="button"
            onClick={actions.closeYaml}
            className="rounded-row p-1.5 text-ink-dim hover:bg-raised hover:text-ink"
            aria-label="Close"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      <div className="h-[calc(100%-37px)]">
        {isIssues ? (
          <IssuesPanel />
        ) : (
          <pre className="h-full overflow-auto p-3 font-mono text-[12px] leading-relaxed text-ink-dim">
            {text || <span className="text-ink-faint">Nothing to show.</span>}
          </pre>
        )}
      </div>
    </div>
  );
}

function FormatTab({
  label,
  active,
  onClick,
  badge,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  badge?: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        'inline-flex items-center gap-1.5 rounded-row px-2 py-1 text-2xs font-medium uppercase tracking-[0.1em]',
        active ? 'bg-raised-strong text-ink' : 'text-ink-dim hover:bg-raised hover:text-ink',
      )}
    >
      <span>{label}</span>
      {badge}
    </button>
  );
}

// CountBadge surfaces error/warning totals in the tab label so a glance
// tells you whether the flow is healthy. Errors take priority on color.
function CountBadge({ errors, warnings }: { errors: number; warnings: number }) {
  const tone = errors > 0 ? 'bg-status-error/20 text-status-error' : 'bg-status-warn/20 text-status-warn';
  return (
    <span
      className={clsx(
        'inline-flex min-w-[18px] items-center justify-center rounded-full px-1 font-mono text-[10px] tabular-nums',
        tone,
      )}
    >
      {errors + warnings}
    </span>
  );
}
