package bff

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"

	"github.com/go-chi/chi/v5"
)

// Handler hosts the /bff/* routes used by the React editor.
//
// The handler keeps frontend-only concerns (drafts, layouts, publish
// status) in `Store` and proxies execution + persistence concerns to
// the controller via `Ctrl`. When `Ctrl` is nil the handler degrades
// gracefully — drafts still save locally, but Run/Publish return 502.
type Handler struct {
	Store *FileStore
	Ctrl  *Controller // optional; nil disables controller-backed routes
}

func NewHandler(store *FileStore, ctrl *Controller) *Handler {
	return &Handler{Store: store, Ctrl: ctrl}
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
	if h.Ctrl != nil {
		p, err := h.Ctrl.GetProject(ctx, projectID)
		if err == nil && p != nil {
			p.Tasks = MergeSeedTasks(p.Tasks)
			seeded := &EnrichedProject{
				Project:       *p,
				Layouts:       map[string]CanvasLayout{},
				PublishStatus: "published",
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
	ep, err := h.loadOrSeed(r.Context(), id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if h.Ctrl == nil {
		writeError(w, http.StatusBadGateway, "controller not configured")
		return
	}
	// Make sure the project ID in the body matches the URL — the
	// controller enforces this and will 400 otherwise.
	ep.Project.ID = id
	if err := h.Ctrl.SaveProject(r.Context(), id, &ep.Project); err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
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
