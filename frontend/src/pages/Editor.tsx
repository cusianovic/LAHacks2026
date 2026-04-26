import AppShell from '@/components/AppShell';
import FlowCanvas from '@/components/canvas/FlowCanvas';
import { FlowStoreProvider, useFlowState } from '@/state/flowStore';

// =====================================================================
// Editor — root page. Wraps the app in the FlowStoreProvider so every
// component can read/write through the reducer. The shell renders the
// canvas as its child.
// =====================================================================

export default function Editor() {
  return (
    <FlowStoreProvider>
      <EditorBody />
    </FlowStoreProvider>
  );
}

function EditorBody() {
  const { status } = useFlowState();
  return (
    <AppShell>
      {status === 'loading' || status === 'idle' ? (
        <div className="flex h-full items-center justify-center text-sm text-ink-faint">
          Loading project…
        </div>
      ) : (
        <FlowCanvas />
      )}
    </AppShell>
  );
}
