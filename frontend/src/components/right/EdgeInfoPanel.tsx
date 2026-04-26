import { useMemo } from 'react';
import { Unlink } from 'lucide-react';

import { useActiveFlow, useFlowActions, useTasks } from '@/state/flowStore';
import { InspectorSection } from '@/components/inspector';
import ListRow from '@/components/common/ListRow';
import { SelectionHeader } from './StepConfigPanel';
import type { Step, Task, TaskEdgeDef } from '@/types/pupload';

// =====================================================================
// EdgeInfoPanel — read-only summary of a wire.
// Shows producer step, consumer step(s), and the intersection of their
// declared mime types so users can spot mismatches.
// =====================================================================

export default function EdgeInfoPanel({ edgeName }: { edgeName: string }) {
  const flow = useActiveFlow();
  const tasks = useTasks();
  const actions = useFlowActions();

  const meta = useMemo(() => {
    if (!flow) return null;
    const producers: { step: Step; def: TaskEdgeDef | undefined }[] = [];
    const consumers: { step: Step; def: TaskEdgeDef | undefined }[] = [];
    const taskFor = (uses: string): Task | undefined => {
      const [pub, name] = uses.split('/');
      return tasks.find((t) => t.Publisher === pub && t.Name === name);
    };
    flow.Steps.forEach((s) => {
      const t = taskFor(s.Uses);
      s.Outputs.forEach((p) => {
        if (p.Edge === edgeName) {
          producers.push({ step: s, def: t?.Outputs.find((d) => d.Name === p.Name) });
        }
      });
      s.Inputs.forEach((p) => {
        if (p.Edge === edgeName) {
          consumers.push({ step: s, def: t?.Inputs.find((d) => d.Name === p.Name) });
        }
      });
    });
    const well = flow.DataWells.find((w) => w.Edge === edgeName);
    return { producers, consumers, well };
  }, [flow, tasks, edgeName]);

  if (!meta) return <div className="p-4 text-sm text-ink-faint">No flow.</div>;

  // Compute mime intersection across all producer/consumer types.
  const allTypes = [
    ...meta.producers.flatMap((p) => p.def?.Type ?? []),
    ...meta.consumers.flatMap((c) => c.def?.Type ?? []),
  ];
  const types = Array.from(new Set(allTypes));
  const intersection = intersectMimes(
    meta.producers.map((p) => p.def?.Type ?? []),
    meta.consumers.map((c) => c.def?.Type ?? []),
  );

  return (
    <div className="flex flex-col">
      <SelectionHeader
        kind="Edge"
        primary={edgeName}
        onDelete={() => actions.deleteEdge(edgeName)}
      />

      <InspectorSection title="Producers">
        {meta.producers.length === 0 ? (
          <EmptyHint>— none —</EmptyHint>
        ) : (
          meta.producers.map(({ step, def }) => (
            <ListRow key={`p-${step.ID}`} mono trailing={<span className="text-[10px] text-ink-faint">{def?.Name}</span>}>
              {step.ID}
            </ListRow>
          ))
        )}
      </InspectorSection>

      <InspectorSection title="Consumers">
        {meta.consumers.length === 0 ? (
          <EmptyHint>— none —</EmptyHint>
        ) : (
          meta.consumers.map(({ step, def }) => (
            <ListRow key={`c-${step.ID}`} mono trailing={<span className="text-[10px] text-ink-faint">{def?.Name}</span>}>
              {step.ID}
            </ListRow>
          ))
        )}
      </InspectorSection>

      {meta.well ? (
        <InspectorSection title="Data Well">
          <ListRow mono>{meta.well.Store || '— unset store —'}</ListRow>
          <ListRow mono>{meta.well.Source ?? '—'}</ListRow>
          <ListRow mono>{meta.well.Key ?? '—'}</ListRow>
        </InspectorSection>
      ) : null}

      <InspectorSection title="Mime Compatibility">
        {types.length === 0 ? (
          <EmptyHint>No mime types declared on either end.</EmptyHint>
        ) : (
          <>
            <div className="flex flex-wrap gap-1">
              {types.map((t) => (
                <span
                  key={t}
                  className="rounded-row bg-raised px-1.5 py-0.5 font-mono text-[10px] leading-none text-ink-dim"
                >
                  {t}
                </span>
              ))}
            </div>
            {intersection.length === 0 ? (
              <EmptyHint>⚠ No overlapping mime types.</EmptyHint>
            ) : (
              <p className="px-1.5 text-[10px] font-light leading-tight text-ink-faint">
                Compatible:{' '}
                {intersection.map((t) => (
                  <span key={t} className="font-mono text-ink-dim">{t} </span>
                ))}
              </p>
            )}
          </>
        )}
      </InspectorSection>

      <InspectorSection title="Actions" bare>
        <button
          type="button"
          onClick={() => actions.deleteEdge(edgeName)}
          className="flex h-7 items-center justify-center gap-1.5 rounded-row bg-raised text-[11px] text-ink hover:bg-raised-hover"
        >
          <Unlink size={11} /> Disconnect
        </button>
      </InspectorSection>
    </div>
  );
}

function EmptyHint({ children }: { children: React.ReactNode }) {
  return (
    <p className="px-1.5 py-1 text-[10px] font-light leading-none text-ink-faint">
      {children}
    </p>
  );
}

/** Intersect lists of mime patterns. Wildcards (`image/*`) match prefixes. */
function intersectMimes(producerLists: string[][], consumerLists: string[][]): string[] {
  if (producerLists.length === 0 || consumerLists.length === 0) return [];
  const allP = producerLists.flat();
  const allC = consumerLists.flat();
  const matches = new Set<string>();
  for (const p of allP) {
    for (const c of allC) {
      if (mimeMatches(p, c)) {
        matches.add(p);
        matches.add(c);
      }
    }
  }
  return Array.from(matches);
}

function mimeMatches(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.endsWith('/*') && b.startsWith(a.slice(0, -1))) return true;
  if (b.endsWith('/*') && a.startsWith(b.slice(0, -1))) return true;
  return false;
}
