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

// Default project id used by the editor on first load. The BFF stub
// recognizes this and returns the seeded sample project.
// Change the projectId in the URL or via app state once multi-project
// support exists.
export const DEFAULT_PROJECT_ID = 'demo';

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

  /** Persist a draft (project + layouts). Idempotent. Does not publish. */
  async saveDraft(
    projectID: string,
    project: Project,
    layouts: Record<string, CanvasLayout>,
    publishStatus: PublishStatus,
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
      if (!USE_LOCAL_FALLBACK) throw err;
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
   * Structural validation of a flow against its tasks.
   * The BFF stub currently returns a placeholder result.
   * TODO(wire): plug in `internal/validation.Validate(flow, tasks)`.
   */
  async validate(flow: Flow, tasks: Task[]): Promise<ValidationResult> {
    return request<ValidationResult>(`/flow/validate`, {
      method: 'POST',
      body: JSON.stringify({ Flow: flow, Tasks: tasks }),
    });
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

/* ----------------------------- Export ------------------------------ */

export const bff = new PuploadBFF();
