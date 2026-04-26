import { useMemo, useState } from 'react';
import { Copy, X } from 'lucide-react';
import clsx from 'clsx';

import { useActiveFlow, useFlowActions, useFlowState } from '@/state/flowStore';
import { flowToJSON, flowToYAML, redactSecrets } from '@/lib/yaml';

// =====================================================================
// YamlPanel — slide-up serialization view at the bottom of the canvas.
// Read-only but copyable. Toggle between YAML and JSON.
// =====================================================================

export default function YamlPanel() {
  const flow = useActiveFlow();
  const { yamlPanel } = useFlowState();
  const actions = useFlowActions();
  const [copied, setCopied] = useState(false);

  const text = useMemo(() => {
    if (!flow) return '';
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

  // Slides up from the bottom of the canvas. Edges are flush with the
  // sidebars; only the top edge has a hairline border so the panel
  // reads as a drawer rising from the floor. The floating pill (z-30)
  // hovers above with `backdrop-blur` to keep content readable.
  return (
    <div className="absolute inset-x-0 bottom-0 z-20 h-[42%] border-t border-border bg-chrome shadow-pill">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <div className="flex items-center gap-1">
          <FormatTab label="YAML" active={yamlPanel.format === 'yaml'} onClick={() => actions.toggleYaml('yaml')} />
          <FormatTab label="JSON" active={yamlPanel.format === 'json'} onClick={() => actions.toggleYaml('json')} />
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={handleCopy}
            className="rounded-row p-1.5 text-ink-dim hover:bg-raised hover:text-ink"
            aria-label="Copy"
          >
            <Copy size={14} />
          </button>
          {copied ? <span className="text-[10px] text-status-saved">Copied</span> : null}
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
      <pre className="h-[calc(100%-37px)] overflow-auto p-3 font-mono text-[12px] leading-relaxed text-ink-dim">
        {text || <span className="text-ink-faint">Nothing to show.</span>}
      </pre>
    </div>
  );
}

function FormatTab({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        'rounded-row px-2 py-1 text-2xs font-medium uppercase tracking-[0.1em]',
        active ? 'bg-raised-strong text-ink' : 'text-ink-dim hover:bg-raised hover:text-ink',
      )}
    >
      {label}
    </button>
  );
}
