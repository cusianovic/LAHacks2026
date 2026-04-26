package bff

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
)

// Handler hosts the /bff/* routes used by the React editor.
//
// The handler keeps frontend-only concerns (drafts, layouts, publish
// status) in `Store` and proxies execution + persistence concerns to
// the controller via `Ctrl`. When `Ctrl` is nil the handler degrades
// gracefully — drafts still save locally, but Run/Publish return 502.
//
// `AI` is the optional Anthropic client used by the AI generation
// endpoint. Nil means "no API key configured"; the handler falls
// back to a hardcoded sample flow so the editor still demos.
type Handler struct {
	Store *FileStore
	Ctrl  *Controller      // optional; nil disables controller-backed routes
	AI    *AnthropicClient // optional; nil falls back to SampleAIFlow
}

func NewHandler(store *FileStore, ctrl *Controller, ai *AnthropicClient) *Handler {
	return &Handler{Store: store, Ctrl: ctrl, AI: ai}
}

// Mount adds /bff/* routes to the given chi router.
func (h *Handler) Mount(r chi.Router) {
	r.Route("/bff", func(r chi.Router) {
		// project
		r.Get("/project/{id}", h.getProject)
		r.Put("/project/{id}", h.putProject)
		r.Post("/project/{id}/publish", h.publishProject)

		// tasks
		r.Get("/project/{id}/tasks", h.getTasks)
		r.Post("/project/{id}/tasks", h.addTask)

		// canvas layout
		r.Post("/project/{id}/layout", h.saveLayout)
		r.Get("/project/{id}/layout", h.getLayouts)

		// flow execution + validation (stubbed)
		r.Post("/flow/validate", h.validateFlow)
		r.Post("/flow/test", h.testFlow)
		r.Get("/flow/status/{id}", h.runStatus)

		// ai
		r.Post("/ai/generate", h.aiGenerate)
	})
}

/* --------------------------- project ----------------------------- */

func (h *Handler) loadOrSeed(ctx context.Context, projectID string) (*EnrichedProject, error) {
	// 1. Local draft wins — preserves in-progress edits across reloads.
	//    Tasks are merged with the current fixture list (`MergeSeedTasks`)
	//    so that adding/fixing a seed task in `fixtures.go` always
	//    reaches the editor on the next load, even though the draft
	//    autosave keeps writing the frontend's in-memory task list back
	//    to disk on every edit.
	ep, ok, err := h.Store.LoadProject(projectID)
	if err != nil {
		return nil, err
	}
	if ok {
		ep.Project.Tasks = MergeSeedTasks(ep.Project.Tasks)
		return ep, nil
	}

	// 2. No draft — try the controller for an already-published project.
	//    Same merge applies: seed tasks always available even if the
	//    controller's stored project predates a fixture update.
	//    LastPublishedHash is computed against the merged project so
	//    the very next edit flips PublishStatus to unpublished_changes.
	if h.Ctrl != nil {
		p, err := h.Ctrl.GetProject(ctx, projectID)
		if err == nil && p != nil {
			p.Tasks = MergeSeedTasks(p.Tasks)
			seeded := &EnrichedProject{
				Project:           *p,
				Layouts:           map[string]CanvasLayout{},
				PublishStatus:     "published",
				LastPublishedHash: hashProject(*p),
			}
			if err := h.Store.SaveProject(projectID, seeded); err != nil {
				return nil, err
			}
			return seeded, nil
		}
		if err != nil && !IsNotFound(err) {
			log.Printf("bff: controller GetProject(%s) failed, falling back to seed: %v", projectID, err)
		}
	}

	// 3. Brand new project — seed with the demo fixture so the editor
	//    has something to render.
	seeded := &EnrichedProject{
		Project:       SeedProject(projectID),
		Layouts:       map[string]CanvasLayout{},
		PublishStatus: "not_published",
	}
	if err := h.Store.SaveProject(projectID, seeded); err != nil {
		return nil, err
	}
	return seeded, nil
}

func (h *Handler) getProject(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	ep, err := h.loadOrSeed(r.Context(), id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, ep)
}

func (h *Handler) putProject(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var ep EnrichedProject
	if err := json.NewDecoder(r.Body).Decode(&ep); err != nil {
		writeError(w, http.StatusBadRequest, fmt.Sprintf("invalid body: %v", err))
		return
	}
	if ep.Project.ID == "" {
		ep.Project.ID = id
	}
	if ep.Layouts == nil {
		ep.Layouts = map[string]CanvasLayout{}
	}
	// PublishStatus is server-derived from the hash. Anything the
	// frontend sent is ignored — the hash is the only thing we trust.
	// LastPublishedHash is owned by the publish path, so preserve it
	// from the existing draft on every PUT (the frontend echoes it back
	// untouched, but if a stale tab sends an empty value we don't want
	// to lose it).
	existing, _, _ := h.Store.LoadProject(id)
	if existing != nil {
		ep.LastPublishedHash = existing.LastPublishedHash
	}
	ep.PublishStatus = derivePublishStatus(ep.Project, ep.LastPublishedHash)
	if err := h.Store.SaveProject(id, &ep); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// publishProject is the BFF's analogue of `pup push`. It pushes the
// current draft to the controller (the source of truth for runs) and,
// on success, records the SHA-256 of the pushed project so subsequent
// edits flip PublishStatus to "unpublished_changes" automatically.
//
// Failure modes:
//   - Ctrl == nil           → 502 "controller not configured" (the
//     operator has to set PUPLOAD_CONTROLLER_URL).
//   - Controller unreachable → 502 with the wrapped network error so
//     the user can see "connection refused".
//   - Controller 4xx/5xx    → 502 with the controller's error body
//     passed through verbatim.
func (h *Handler) publishProject(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	ep, err := h.loadOrSeed(r.Context(), id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if h.Ctrl == nil {
		writeError(w, http.StatusBadGateway, "controller not configured (set PUPLOAD_CONTROLLER_URL)")
		return
	}
	// Make sure the project ID in the body matches the URL — the
	// controller enforces this and will 400 otherwise.
	ep.Project.ID = id
	log.Printf("bff: publishing project %s → %s", id, h.Ctrl.BaseURL)
	if err := h.Ctrl.SaveProject(r.Context(), id, &ep.Project); err != nil {
		log.Printf("bff: publish failed for %s: %v", id, err)
		writeError(w, http.StatusBadGateway, fmt.Sprintf("controller push failed: %v", err))
		return
	}
	// The controller mutates the canonical project before responding
	// (it normalises stores, generates UUIDs, etc.) but for the hash
	// to be useful as a "have we drifted since last push?" signal it
	// must be computed against the local copy that the user is
	// editing. Hashing the post-push project would mark every save
	// after the first as "unpublished_changes".
	ep.LastPublishedHash = hashProject(ep.Project)
	ep.PublishStatus = "published"
	if err := h.Store.SaveProject(id, ep); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	log.Printf("bff: published project %s (hash=%s)", id, ep.LastPublishedHash[:8])
	writeJSON(w, http.StatusOK, buildPublishResult(h.Ctrl.BaseURL, id, ep.Project))
}

// buildPublishResult enumerates the flows the user just published and
// constructs the trigger URL for each (as documented in
// `04-controller-api-reference.md`: `POST /api/v1/project/:id/flows/:name`).
// The popover in the editor renders this verbatim — keep the field
// names in sync with the `PublishResult` TS type.
func buildPublishResult(controllerURL, projectID string, p Project) PublishResult {
	flows := make([]PublishedFlowRef, 0, len(p.Flows))
	for _, f := range p.Flows {
		steps := make([]PublishedFlowStep, 0, len(f.Steps))
		for _, s := range f.Steps {
			steps = append(steps, PublishedFlowStep{ID: s.ID, Uses: s.Uses})
		}
		flows = append(flows, PublishedFlowRef{
			Name:   f.Name,
			Method: http.MethodPost,
			URL:    fmt.Sprintf("%s/api/v1/project/%s/flows/%s", controllerURL, projectID, f.Name),
			Steps:  steps,
		})
	}
	return PublishResult{
		ControllerURL: controllerURL,
		ProjectID:     projectID,
		Flows:         flows,
	}
}

// hashProject returns a stable SHA-256 hex digest of the project's
// canonical JSON. Used to drive `PublishStatus`. Ignores layout and
// publish-status metadata — only the controller-bound payload counts.
func hashProject(p Project) string {
	data, err := json.Marshal(&p)
	if err != nil {
		// Marshal failure on a struct that successfully round-tripped
		// from a previous Marshal/Unmarshal pair would be a programmer
		// error. Returning a sentinel keeps this off the hot path of
		// every save without panicking.
		return ""
	}
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])
}

// derivePublishStatus maps a project + last-published hash pair to
// the discriminated status the frontend renders. Centralised so the
// PUT and the publish handlers can't disagree on the rules.
func derivePublishStatus(p Project, lastHash string) string {
	if lastHash == "" {
		return "not_published"
	}
	if hashProject(p) == lastHash {
		return "published"
	}
	return "unpublished_changes"
}

/* ----------------------------- tasks ----------------------------- */

func (h *Handler) getTasks(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	ep, err := h.loadOrSeed(r.Context(), id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, ep.Project.Tasks)
}

func (h *Handler) addTask(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var task Task
	if err := json.NewDecoder(r.Body).Decode(&task); err != nil {
		writeError(w, http.StatusBadRequest, fmt.Sprintf("invalid body: %v", err))
		return
	}
	ep, err := h.loadOrSeed(r.Context(), id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	// Replace existing publisher/name if it already exists.
	replaced := false
	for i, t := range ep.Project.Tasks {
		if t.Publisher == task.Publisher && t.Name == task.Name {
			ep.Project.Tasks[i] = task
			replaced = true
			break
		}
	}
	if !replaced {
		ep.Project.Tasks = append(ep.Project.Tasks, task)
	}
	ep.PublishStatus = "unpublished_changes"
	if err := h.Store.SaveProject(id, ep); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, ep.Project.Tasks)
}

/* ------------------------- canvas layout ------------------------- */

func (h *Handler) saveLayout(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var layout CanvasLayout
	if err := json.NewDecoder(r.Body).Decode(&layout); err != nil {
		writeError(w, http.StatusBadRequest, fmt.Sprintf("invalid body: %v", err))
		return
	}
	ep, err := h.loadOrSeed(r.Context(), id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if ep.Layouts == nil {
		ep.Layouts = map[string]CanvasLayout{}
	}
	ep.Layouts[layout.FlowName] = layout
	if err := h.Store.SaveProject(id, ep); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) getLayouts(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	ep, err := h.loadOrSeed(r.Context(), id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if ep.Layouts == nil {
		writeJSON(w, http.StatusOK, map[string]CanvasLayout{})
		return
	}
	writeJSON(w, http.StatusOK, ep.Layouts)
}

/* ------------------------ validate / run ------------------------- */

func (h *Handler) validateFlow(w http.ResponseWriter, r *http.Request) {
	var req ValidateRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, fmt.Sprintf("invalid body: %v", err))
		return
	}
	if h.Ctrl == nil {
		// No controller wired — surface a clean empty result. The
		// frontend treats this as "nothing to show" and the editor
		// keeps working with no validation feedback.
		writeJSON(w, http.StatusOK, ValidationResult{
			Errors:   []ValidationEntry{},
			Warnings: []ValidationEntry{},
		})
		return
	}
	result, err := h.Ctrl.ValidateFlow(r.Context(), req.Flow, req.Tasks)
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	// The controller emits nil slices as JSON `null` when there are
	// no entries. Coerce to empty slices so the wire shape always
	// matches the documented `{"Errors":[],"Warnings":[]}` contract.
	if result.Errors == nil {
		result.Errors = []ValidationEntry{}
	}
	if result.Warnings == nil {
		result.Warnings = []ValidationEntry{}
	}
	writeJSON(w, http.StatusOK, result)
}

func (h *Handler) testFlow(w http.ResponseWriter, r *http.Request) {
	var req TestFlowRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, fmt.Sprintf("invalid body: %v", err))
		return
	}
	if h.Ctrl == nil {
		writeError(w, http.StatusBadGateway, "controller not configured")
		return
	}
	run, err := h.Ctrl.TestFlow(r.Context(), req.Flow, req.Tasks)
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, run)
}

func (h *Handler) runStatus(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if h.Ctrl == nil {
		writeError(w, http.StatusBadGateway, "controller not configured")
		return
	}
	run, err := h.Ctrl.GetFlowStatus(r.Context(), id)
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, run)
}

/* ------------------------------ ai ------------------------------- */

// aiGenerate turns the operator's prompt into a structured Flow.
//
// Pipeline (see `ai_generate.go` for the heavy lifting):
//  1. Decode `AIGenerateRequest` from the body.
//  2. Load the project so the generator can target real task IDs.
//  3. Either dispatch to Claude (`generateAIFlow`) or fall back to
//     `SampleAIFlow` if no API key is configured.
//  4. Return `AIGenerateResult` JSON. Errors are surfaced as 502s
//     with a human-readable message the modal renders inline.
//
// The handler does NOT mutate the project here — the editor calls
// `actions.hydrateFromAI` client-side, which then triggers an
// autosave that round-trips to `PUT /bff/project/:id`. Keeping the
// AI endpoint pure makes it easy to retry on the frontend without
// having to roll back partial server state.
func (h *Handler) aiGenerate(w http.ResponseWriter, r *http.Request) {
	var req AIGenerateRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, fmt.Sprintf("invalid body: %v", err))
		return
	}
	if strings.TrimSpace(req.Prompt) == "" {
		writeError(w, http.StatusBadRequest, "prompt is required")
		return
	}

	// No API key → keep the demo working with a fixed sample. Make the
	// origin of the response visible to the user via a warning so the
	// behaviour isn't mysterious if the key wasn't picked up by env.
	if h.AI == nil {
		log.Printf("bff: ai_generate: ANTHROPIC_API_KEY not set, returning sample flow")
		result := SampleAIFlow(req.Prompt)
		result.Warnings = append([]string{
			"Sample response \u2014 set ANTHROPIC_API_KEY to enable real generation.",
		}, result.Warnings...)
		writeJSON(w, http.StatusOK, result)
		return
	}

	// Pull the current project so the generator knows what task palette
	// the model can target. `loadOrSeed` handles the "first run, no
	// draft yet" case for us.
	ep, err := h.loadOrSeed(r.Context(), req.ProjectID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, fmt.Sprintf("load project: %v", err))
		return
	}

	// Edit-mode context: if the frontend told us which flow is active
	// AND that flow exists on the project AND it has at least one step,
	// hand it (and its layout) to the generator so the model edits in
	// place rather than fabricating a fresh flow. The frontend flushes
	// its autosave before this call (see AiGenerateModal) so what we
	// load here matches what's on the canvas.
	var (
		currentFlow   *Flow
		currentLayout *CanvasLayout
	)
	if req.ActiveFlowName != "" {
		for i := range ep.Project.Flows {
			if ep.Project.Flows[i].Name == req.ActiveFlowName {
				currentFlow = &ep.Project.Flows[i]
				break
			}
		}
		if layout, ok := ep.Layouts[req.ActiveFlowName]; ok {
			// Take a copy so the generator can mutate freely without
			// stomping on the persisted layout.
			cloned := layout
			currentLayout = &cloned
		}
	}

	result, err := generateAIFlow(r.Context(), h.AI, &ep.Project, currentFlow, currentLayout, req.Prompt)
	if err != nil {
		log.Printf("bff: ai_generate failed for project %s: %v", req.ProjectID, err)
		writeError(w, http.StatusBadGateway, fmt.Sprintf("ai generation failed: %v", err))
		return
	}
	writeJSON(w, http.StatusOK, result)
}

/* ----------------------------- helpers --------------------------- */

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]any{"error": msg})
}
