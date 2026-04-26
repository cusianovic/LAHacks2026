import { useState } from 'react';
import { AlertTriangle, Sparkles, Wand2 } from 'lucide-react';

import Modal from '@/components/common/Modal';
import Button from '@/components/common/Button';
import { bff } from '@/lib/bff';
import { useActiveFlow, useFlowActions, useFlowState } from '@/state/flowStore';

// =====================================================================
// AiGenerateModal — single textarea, single button.
//
// On submit the modal hits `bff.generateFlow(projectID, prompt)`.
// The BFF dispatches to Claude (`internal/api/bff/ai_generate.go`),
// runs validation + auto-layout, and returns the structured Flow +
// Layout + any new tasks the model proposed. We hydrate the canvas
// immediately on success; if the response carries warnings, we keep
// the modal open with an inline warnings panel so the operator can
// read them before dismissing.
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
  const { projectID, project, layouts, publishStatus } = useFlowState();
  const activeFlow = useActiveFlow();
  const [prompt, setPrompt] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Warnings from the last successful generation. Surfacing these
  // matters because the BFF emits soft-fail signals (orphan datawells,
  // "sample mode" notice when ANTHROPIC_API_KEY is missing, etc.)
  // that we don't want to swallow silently.
  const [warnings, setWarnings] = useState<string[]>([]);

  // Edit mode kicks in whenever the active flow has at least one step.
  // The BFF reads the persisted draft to build the model context, so
  // a brand-new flow with zero steps would just get replaced wholesale
  // — we treat that as "create from scratch" instead.
  const editMode = (activeFlow?.Steps?.length ?? 0) > 0;
  const activeFlowName = editMode ? activeFlow?.Name : undefined;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt.trim() || loading) return;
    setLoading(true);
    setError(null);
    setWarnings([]);
    try {
      // Flush any pending autosave so the BFF reads the same flow the
      // user is looking at. `strict: true` opts out of the localStorage
      // fallback — if the BFF is unreachable we'd rather fail loudly
      // than have the model edit a stale on-disk copy.
      if (editMode) {
        await bff.saveDraft(projectID, project, layouts, publishStatus, {
          strict: true,
        });
      }
      const result = await bff.generateFlow(projectID, prompt, activeFlowName);
      actions.hydrateFromAI(result.flow, result.layout, result.newTasks);
      const ws = result.warnings ?? [];
      if (ws.length > 0) {
        // Keep the modal open so the user can read the warnings.
        // Reset the prompt so a follow-up regen starts blank, but
        // leave the warnings visible until the user dismisses or
        // submits another prompt.
        setWarnings(ws);
        setPrompt('');
      } else {
        setPrompt('');
        onClose();
      }
    } catch (err) {
      setError(formatBFFError(err));
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
          {editMode ? (
            <Wand2 size={14} className="text-accent-dim" />
          ) : (
            <Sparkles size={14} className="text-accent-dim" />
          )}
          {editMode ? `Edit “${activeFlow?.Name}” with AI` : 'Generate Flow with AI'}
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
              leftIcon={editMode ? <Wand2 size={12} /> : <Sparkles size={12} />}
            >
              {loading
                ? editMode
                  ? 'Editing…'
                  : 'Generating…'
                : editMode
                  ? 'Apply edit'
                  : 'Generate'}
            </Button>
          </div>
        </div>
      }
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        {editMode ? (
          <p className="text-sm text-ink-dim">
            Describe what to change. The AI will modify the current flow in
            place — unchanged steps, datawells, and canvas positions are
            preserved. Ask it to add, remove, rewire, or tweak anything.
          </p>
        ) : (
          <p className="text-sm text-ink-dim">
            Describe the pipeline you want to build. The AI can also propose new
            task definitions if your project doesn't have a matching one.
          </p>
        )}
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
              void handleSubmit(e as unknown as React.FormEvent);
            }
          }}
          placeholder={
            editMode
              ? 'e.g. Add a 480p variant alongside the existing renditions.'
              : 'e.g. Upload an image, resize it to three resolutions, and store each in S3.'
          }
          className="min-h-[140px] w-full resize-y rounded-row border border-border bg-raised px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none"
          autoFocus
        />
        {error ? <ErrorBanner message={error} /> : null}
        {warnings.length > 0 ? <WarningsBanner warnings={warnings} /> : null}
        <ExampleChips onPick={(text) => setPrompt(text)} editMode={editMode} />
      </form>
    </Modal>
  );
}

/* ----------------------------- helpers ----------------------------- */

// formatBFFError produces a human-readable summary of an error from
// the bff client. The raw `BFFError` message includes the URL/status
// prefix which is noisy in the UI; we strip it down to just the
// server's message body.
function formatBFFError(err: unknown): string {
  if (!(err instanceof Error)) return 'Generation failed.';
  const msg = err.message;
  // Pattern: "BFF /ai/generate → 502: {\"error\":\"...\"}"
  const arrowIdx = msg.indexOf(': ');
  if (arrowIdx > 0 && msg.startsWith('BFF ')) {
    const tail = msg.slice(arrowIdx + 2);
    try {
      const parsed = JSON.parse(tail);
      if (parsed && typeof parsed.error === 'string') return parsed.error;
    } catch {
      // Not JSON — fall through and return the tail as-is.
    }
    return tail;
  }
  return msg;
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-2 rounded-row border border-red-500/30 bg-red-500/10 px-3 py-2 text-2xs text-red-200">
      <AlertTriangle size={12} className="mt-0.5 shrink-0 text-red-300" />
      <span className="break-words">{message}</span>
    </div>
  );
}

function WarningsBanner({ warnings }: { warnings: string[] }) {
  return (
    <div className="flex items-start gap-2 rounded-row border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-2xs text-amber-100">
      <AlertTriangle size={12} className="mt-0.5 shrink-0 text-amber-300" />
      <div className="flex flex-col gap-1">
        <span className="font-medium text-amber-100">
          Generated with {warnings.length} {warnings.length === 1 ? 'warning' : 'warnings'}:
        </span>
        <ul className="flex list-disc flex-col gap-0.5 pl-4">
          {warnings.map((w, i) => (
            <li key={i} className="break-words">{w}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function ExampleChips({
  onPick,
  editMode,
}: {
  onPick: (text: string) => void;
  editMode: boolean;
}) {
  const examples = editMode
    ? [
        'Add an audio-extract step that writes an mp3 alongside the video output.',
        'Drop the 480p rendition.',
        'Add a watermark step before each encode using a static logo upload.',
      ]
    : [
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
