package bff

import (
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
)

// Handler hosts the /bff/* routes used by the React editor.
//
// Each handler is intentionally short — most of them simply read or
// write through the FileStore, or return a hardcoded fixture marked
// with `TODO(wire)`. Replace those swap points individually as the
// Pupload engine packages come online.
type Handler struct {
	Store *FileStore
}

func NewHandler(store *FileStore) *Handler {
	return &Handler{Store: store}
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

func (h *Handler) loadOrSeed(projectID string) (*EnrichedProject, error) {
	ep, ok, err := h.Store.LoadProject(projectID)
	if err != nil {
		return nil, err
	}
	if ok {
		return ep, nil
	}
	// First request for this project — seed and persist so subsequent
	// PUTs build off a stable baseline.
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
	ep, err := h.loadOrSeed(id)
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
	if ep.PublishStatus == "" {
		ep.PublishStatus = "unpublished_changes"
	}
	if ep.Layouts == nil {
		ep.Layouts = map[string]CanvasLayout{}
	}
	if err := h.Store.SaveProject(id, &ep); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) publishProject(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	ep, err := h.loadOrSeed(id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	// TODO(wire): forward POST /api/v1/project/:id to the controller here.
	ep.PublishStatus = "published"
	if err := h.Store.SaveProject(id, ep); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

/* ----------------------------- tasks ----------------------------- */

func (h *Handler) getTasks(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	ep, err := h.loadOrSeed(id)
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
	ep, err := h.loadOrSeed(id)
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
	ep, err := h.loadOrSeed(id)
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
	ep, err := h.loadOrSeed(id)
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
	// TODO(wire): replace this with a call to internal/validation.Validate(flow, tasks).
	writeJSON(w, http.StatusOK, ValidationResult{
		Errors:   []ValidationEntry{},
		Warnings: []ValidationEntry{},
	})
}

func (h *Handler) testFlow(w http.ResponseWriter, r *http.Request) {
	var req TestFlowRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, fmt.Sprintf("invalid body: %v", err))
		return
	}
	// TODO(wire): proxy to controller POST /api/v1/flow/test.
	stub := FlowRun{
		ID:          fmt.Sprintf("run-stub-%d", time.Now().UnixMilli()),
		Status:      "STOPPED",
		StepState:   map[string]StepState{},
		Artifacts:   map[string]Artifact{},
		WaitingURLs: []WaitingURL{},
		StartedAt:   time.Now().UTC().Format(time.RFC3339),
	}
	writeJSON(w, http.StatusOK, stub)
}

func (h *Handler) runStatus(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	// TODO(wire): proxy to controller GET /api/v1/flow/status/:id.
	writeJSON(w, http.StatusOK, FlowRun{
		ID:          id,
		Status:      "STOPPED",
		StepState:   map[string]StepState{},
		Artifacts:   map[string]Artifact{},
		WaitingURLs: []WaitingURL{},
		StartedAt:   time.Now().UTC().Format(time.RFC3339),
	})
}

/* ------------------------------ ai ------------------------------- */

func (h *Handler) aiGenerate(w http.ResponseWriter, r *http.Request) {
	var req AIGenerateRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, fmt.Sprintf("invalid body: %v", err))
		return
	}
	// TODO(wire): call Claude with the project's tasks/stores + req.Prompt
	// and parse the result. For now we return a fixed sample so the
	// canvas-hydration path is testable end-to-end without an API key.
	result := SampleAIFlow(req.Prompt)
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
