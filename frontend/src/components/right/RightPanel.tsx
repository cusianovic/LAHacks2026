import { useFlowState } from '@/state/flowStore';

import FlowSettingsPanel from './FlowSettingsPanel';
import StepConfigPanel from './StepConfigPanel';
import EdgeInfoPanel from './EdgeInfoPanel';
import DataWellPanel from './DataWellPanel';

// =====================================================================
// RightPanel — context-sensitive inspector.
//
// No tabs, no chrome. Just renders the relevant sub-panel based on the
// current selection. Each sub-panel is a stack of `InspectorSection`s
// using the inspector primitives — see `src/components/inspector/`.
//
// Selection routing:
//   nothing selected → FlowSettings
//   step             → StepConfig
//   edge             → EdgeInfo
//   datawell         → DataWell
// =====================================================================

export default function RightPanel() {
  const { selection } = useFlowState();

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      {selection.type === 'step' ? (
        <StepConfigPanel stepID={selection.id} />
      ) : selection.type === 'edge' ? (
        <EdgeInfoPanel edgeName={selection.id} />
      ) : selection.type === 'datawell' ? (
        <DataWellPanel edge={selection.id} />
      ) : (
        <FlowSettingsPanel />
      )}
    </div>
  );
}
