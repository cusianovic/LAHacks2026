import { useState } from 'react';
import { Sparkles } from 'lucide-react';

import Modal from '@/components/common/Modal';
import Button from '@/components/common/Button';
import { bff, DEFAULT_PROJECT_ID } from '@/lib/bff';
import { useFlowActions } from '@/state/flowStore';

// =====================================================================
// AiGenerateModal — single textarea, single button.
//
// On submit the modal hits `bff.generateFlow(projectID, prompt)`.
// The Go BFF currently returns a hardcoded sample flow — once swapped
// for a real Claude call, the frontend behavior won't change.
//
// TODO(wire): stream flow construction (each step appears one at a
//             time) once the BFF supports SSE/WebSocket streaming.
// =====================================================================

interface AiGenerateModalProps {
  open: boolean;
  onClose: () => void;
}

export default function AiGenerateModal({ open, onClose }: AiGenerateModalProps) {
  const actions = useFlowActions();
  const [prompt, setPrompt] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt.trim() || loading) return;
    setLoading(true);
    setError(null);
    try {
      const result = await bff.generateFlow(DEFAULT_PROJECT_ID, prompt);
      actions.hydrateFromAI(result.flow, result.layout, result.newTasks);
      setPrompt('');
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Generation failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={
        <span className="flex items-center gap-2">
          <Sparkles size={14} className="text-accent-dim" />
          Generate Flow with AI
        </span>
      }
      footer={
        <div className="flex items-center justify-between gap-3">
          <span className="text-2xs text-ink-faint">
            Cmd/Ctrl+Enter to submit
          </span>
          <div className="flex items-center gap-2">
            <Button variant="ghost" type="button" onClick={onClose}>
              Cancel
            </Button>
            <Button
              variant="primary"
              type="button"
              disabled={loading || !prompt.trim()}
              onClick={(e) => handleSubmit(e as unknown as React.FormEvent)}
              leftIcon={<Sparkles size={12} />}
            >
              {loading ? 'Generating…' : 'Generate'}
            </Button>
          </div>
        </div>
      }
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <p className="text-sm text-ink-dim">
          Describe the pipeline you want to build. The AI can also propose new task
          definitions if your project doesn't have a matching one.
        </p>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
              void handleSubmit(e as unknown as React.FormEvent);
            }
          }}
          placeholder="e.g. Upload an image, resize it to three resolutions, and store each in S3."
          className="min-h-[140px] w-full resize-y rounded-row border border-border bg-raised px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none"
          autoFocus
        />
        {error ? <p className="text-2xs text-red-300">{error}</p> : null}
        <ExampleChips onPick={(text) => setPrompt(text)} />
      </form>
    </Modal>
  );
}

function ExampleChips({ onPick }: { onPick: (text: string) => void }) {
  const examples = [
    'Transcode an uploaded video to 480p, 720p, 1080p and store all variants in S3.',
    'Take an uploaded PDF, extract text, summarize with an LLM, write the summary to S3.',
    'Run virus scan on every upload then push clean files to a public bucket.',
  ];
  return (
    <div className="flex flex-wrap gap-1.5">
      {examples.map((ex) => (
        <button
          key={ex}
          type="button"
          onClick={() => onPick(ex)}
          className="rounded-full border border-border bg-raised px-2.5 py-1 text-2xs text-ink-dim hover:border-ink-faint hover:text-ink"
        >
          {ex}
        </button>
      ))}
    </div>
  );
}
