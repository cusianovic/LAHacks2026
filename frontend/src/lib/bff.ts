// =====================================================================
// PuploadBFF — the *only* place the frontend talks to the backend.
//
// Every component imports `bff` from here. No `fetch`, no `axios.get`,
// no direct calls to the controller anywhere else. This keeps the
// boundary defined in `02-abstraction-layer.md` enforceable by grep:
//
//   $ grep -RIn "fetch(" frontend/src      # should only hit this file
//
// All methods correspond 1:1 to a route on the Go BFF stub at
// `internal/api/bff/`. Swap `baseURL` to point at a real BFF later;
// the rest of the app does not care.
//
// TODO(wire): replace stub responses with real engine logic on the
//             Go side — this client should not need to change.
// =====================================================================

import type {
  AIGenerateResult,
  CanvasLayout,
  EnrichedProject,
  Flow,
  FlowRun,
  Project,
  PublishStatus,
  Task,
  ValidationResult,
} from '@/types/pupload';

/* ------------------------ Configuration ---------------------------- */

// In dev the BFF is served from the same origin via Vite's proxy
// (`vite.config.ts` forwards `/bff` to the Go server). In production
// the Go server serves both the SPA and the BFF, so relative URLs work.
const BFF_BASE_URL = '/bff';

// Default project id used by the editor on first load.
//
// Must be a valid UUID v7 — the controller's `models.Project.ID` is a
// `uuid.UUID`, so non-UUID strings are rejected at JSON-decode time
// before any business logic runs (publish would silently 400).
//
// Kept in sync with `internal/api/bff/fixtures.go::DemoProjectID`.
// On first boot the BFF migrates any pre-existing `data/drafts/demo.json`
// to this UUID-keyed file so the user's saved flows survive the rename.
export const DEFAULT_PROJECT_ID = '019790a0-0000-7000-9000-000000000001';

// LocalStorage cache key — used as a fallback when the BFF is
// unreachable so the demo still loads. Toggle with `USE_LOCAL_FALLBACK`.
const USE_LOCAL_FALLBACK = true;
const LS_DRAFT_KEY = (id: string) => `pupload:draft:${id}`;
const LS_LAYOUT_KEY = (id: string) => `pupload:layout:${id}`;

/* ------------------------ Internal helpers ------------------------- */

async function request<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(`${BFF_BASE_URL}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new BFFError(res.status, `BFF ${path} → ${res.status}: ${body || res.statusText}`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export class BFFError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'BFFError';
  }
}

/* ----------------------------- Client ------------------------------ */

class PuploadBFF {
  /* ── Project ─────────────────────────────────────────────────── */

  /**
   * Load an enriched project (Project + canvas layouts + publish status).
   * Falls back to localStorage if the BFF is unreachable so the demo
   * keeps working offline.
   */
  async loadProject(projectID: string): Promise<EnrichedProject> {
    try {
      return await request<EnrichedProject>(`/project/${projectID}`);
    } catch (err) {
      if (USE_LOCAL_FALLBACK) {
        const cached = readLS<EnrichedProject>(LS_DRAFT_KEY(projectID));
        if (cached) {
          console.warn('[bff] using localStorage fallback for project', projectID, err);
          return cached;
        }
      }
      throw err;
    }
  }

  /** Persist a draft (project + layouts). Idempotent. Does not publish.
   *
   *  By default a BFF failure is swallowed and the payload is kept in
   *  localStorage — that keeps autosave from spamming the user with
   *  toasts when the dev server blips. Pass `{ strict: true }` from
   *  flows where a successful round-trip is a precondition for the
   *  next call (e.g. Publish) so the caller can react to the error
   *  instead of pushing a stale on-disk draft. */
  async saveDraft(
    projectID: string,
    project: Project,
    layouts: Record<string, CanvasLayout>,
    publishStatus: PublishStatus,
    opts: { strict?: boolean } = {},
  ): Promise<void> {
    const payload: EnrichedProject = { project, layouts, publishStatus };
    if (USE_LOCAL_FALLBACK) {
      writeLS(LS_DRAFT_KEY(projectID), payload);
    }
    try {
      await request<void>(`/project/${projectID}`, {
        method: 'PUT',
        body: JSON.stringify(payload),
      });
    } catch (err) {
      if (opts.strict || !USE_LOCAL_FALLBACK) throw err;
      console.warn('[bff] saveDraft failed, kept in localStorage', err);
    }
  }

  /** Push the current draft to the controller. */
  async publish(projectID: string): Promise<void> {
    await request<void>(`/project/${projectID}/publish`, { method: 'POST' });
  }

  /* ── Tasks ───────────────────────────────────────────────────── */

  async getTasks(projectID: string): Promise<Task[]> {
    return request<Task[]>(`/project/${projectID}/tasks`);
  }

  async addTask(projectID: string, task: Task): Promise<Task[]> {
    return request<Task[]>(`/project/${projectID}/tasks`, {
      method: 'POST',
      body: JSON.stringify(task),
    });
  }

  /* ── Canvas Layout ───────────────────────────────────────────── */

  async saveLayout(projectID: string, layout: CanvasLayout): Promise<void> {
    if (USE_LOCAL_FALLBACK) {
      const all = readLS<Record<string, CanvasLayout>>(LS_LAYOUT_KEY(projectID)) ?? {};
      all[layout.flowName] = layout;
      writeLS(LS_LAYOUT_KEY(projectID), all);
    }
    try {
      await request<void>(`/project/${projectID}/layout`, {
        method: 'POST',
        body: JSON.stringify(layout),
      });
    } catch (err) {
      if (!USE_LOCAL_FALLBACK) throw err;
      console.warn('[bff] saveLayout failed, kept in localStorage', err);
    }
  }

  async getLayouts(projectID: string): Promise<Record<string, CanvasLayout>> {
    return request<Record<string, CanvasLayout>>(`/project/${projectID}/layout`);
  }

  /* ── Validation ──────────────────────────────────────────────── */

  /**
   * Structural validation of a flow against its tasks. The BFF
   * proxies to the controller's `/api/v1/flow/validate` (see
   * `internal/api/bff/handler.go::validateFlow`); the controller is
   * the only validator the editor uses. If no controller is
   * configured the BFF returns an empty `{Errors:[],Warnings:[]}`.
   */
  async validate(flow: Flow, tasks: Task[]): Promise<ValidationResult> {
    const result = await request<Partial<ValidationResult>>(`/flow/validate`, {
      method: 'POST',
      body: JSON.stringify({ Flow: flow, Tasks: tasks }),
    });
    // The controller marshals empty Go slices as JSON `null`, which
    // would crash callers doing `.length`. Normalise at the boundary.
    return {
      Errors: result.Errors ?? [],
      Warnings: result.Warnings ?? [],
    };
  }

  /* ── Flow Execution ──────────────────────────────────────────── */

  /**
   * Submit a flow for a test run.
   * TODO(wire): proxy to controller `POST /api/v1/flow/test`.
   */
  async testFlow(flow: Flow, tasks: Task[]): Promise<FlowRun> {
    return request<FlowRun>(`/flow/test`, {
      method: 'POST',
      body: JSON.stringify({ Flow: flow, Tasks: tasks }),
    });
  }

  /**
   * Poll a run's status. Caller is responsible for the polling cadence
   * (typical: 2s interval, stop on COMPLETE/ERROR).
   * TODO(wire): proxy to controller `GET /api/v1/flow/status/:id`.
   */
  async getRunStatus(runID: string): Promise<FlowRun> {
    return request<FlowRun>(`/flow/status/${runID}`);
  }

  /**
   * Upload a Blob/File directly to a presigned PUT URL returned in
   * `FlowRun.WaitingURLs[i].PutURL`. The URL is signed by the controller
   * for the underlying object store (S3/MinIO), so this request bypasses
   * the BFF entirely — that's by design (see `04-controller-api-reference.md`,
   * "Upload Flow (Presigned URLs)").
   */
  async uploadToPresignedURL(putURL: string, data: Blob): Promise<void> {
    const res = await fetch(putURL, {
      method: 'PUT',
      body: data,
      // Don't set Content-Type unless the signature was generated for a
      // specific one. MinIO/S3 will reject the upload if the header
      // disagrees with the signature.
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new BFFError(res.status, `upload PUT → ${res.status}: ${body || res.statusText}`);
    }
  }

  /**
   * Drive a run to completion: poll `getRunStatus` every `intervalMs`,
   * invoking `onTick` with each FlowRun. Resolves when the run reaches
   * `COMPLETE` or `ERROR`, or rejects if the polled call fails.
   *
   * The caller can abort via the `signal` option (e.g. on unmount).
   */
  async pollRun(
    runID: string,
    onTick: (run: FlowRun) => void,
    opts: { intervalMs?: number; signal?: AbortSignal } = {},
  ): Promise<FlowRun> {
    const intervalMs = opts.intervalMs ?? 1500;
    while (true) {
      if (opts.signal?.aborted) throw new DOMException('aborted', 'AbortError');
      const run = await this.getRunStatus(runID);
      onTick(run);
      if (run.Status === 'COMPLETE' || run.Status === 'ERROR') return run;
      await sleep(intervalMs, opts.signal);
    }
  }

  /* ── AI Generation ───────────────────────────────────────────── */

  /**
   * Generate a flow from a natural language prompt.
   * The BFF stub returns a hardcoded sample so the canvas-hydration
   * path is testable end-to-end without an AI key.
   * TODO(wire): swap the stub for a Claude call on the Go side.
   */
  async generateFlow(projectID: string, prompt: string): Promise<AIGenerateResult> {
    return request<AIGenerateResult>(`/ai/generate`, {
      method: 'POST',
      body: JSON.stringify({ projectID, prompt }),
    });
  }
}

/* ------------------------- LocalStorage I/O ------------------------ */

function readLS<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeLS(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore quota errors */
  }
}

/**
 * setTimeout-based sleep that also resolves early when an AbortSignal
 * fires. Used by `pollRun` so callers can cancel polling cleanly (e.g.
 * on component unmount).
 */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('aborted', 'AbortError'));
      return;
    }
    const timer = window.setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      window.clearTimeout(timer);
      reject(new DOMException('aborted', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/* ----------------------------- Export ------------------------------ */

export const bff = new PuploadBFF();
