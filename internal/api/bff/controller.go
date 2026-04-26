package bff

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// Controller is the BFF's HTTP client for the Pupload controller engine
// described in `04-controller-api-reference.md`. It speaks the
// `/api/v1/*` API and is the only place in this repo that knows the
// controller's URL.
//
// All methods accept a `context.Context` so they participate in the
// request's cancellation/timeout chain.
//
// Error handling matches the controller's contract: error bodies are
// plain text. On non-200 we return a typed `ControllerError` so callers
// can distinguish (e.g. 404 → seed fallback, 500 → bubble up).
type Controller struct {
	BaseURL string
	HTTP    *http.Client
}

// NewController builds a Controller pointed at baseURL (no trailing slash).
// Callers should pass `cfg.ControllerURL`.
func NewController(baseURL string) *Controller {
	return &Controller{
		BaseURL: strings.TrimRight(baseURL, "/"),
		HTTP: &http.Client{
			Timeout: 30 * time.Second,
		},
	}
}

// ControllerError is returned for any non-2xx response from the controller.
// It carries both the status code and the response body so the BFF can
// decide what to do (e.g. surface to the user, fall back to a stub, etc.).
type ControllerError struct {
	Status int
	Body   string
	Op     string // human-readable operation, e.g. "POST /api/v1/flow/test"
}

func (e *ControllerError) Error() string {
	if e.Body == "" {
		return fmt.Sprintf("controller %s → %d", e.Op, e.Status)
	}
	return fmt.Sprintf("controller %s → %d: %s", e.Op, e.Status, e.Body)
}

// IsNotFound is true if err is a *ControllerError with status 404.
func IsNotFound(err error) bool {
	var ce *ControllerError
	if errors.As(err, &ce) {
		return ce.Status == http.StatusNotFound
	}
	return false
}

/* ----------------------------- Project --------------------------- */

// GetProject fetches a project from the controller. Returns (nil, nil)
// when the controller returns 404 — the BFF treats that as "no project
// yet" and falls back to a seeded draft.
func (c *Controller) GetProject(ctx context.Context, id string) (*Project, error) {
	body, err := c.do(ctx, http.MethodGet, "/api/v1/project/"+id, nil)
	if err != nil {
		if IsNotFound(err) {
			return nil, nil
		}
		return nil, err
	}
	var p Project
	if err := json.Unmarshal(body, &p); err != nil {
		return nil, fmt.Errorf("controller GET project: parse: %w", err)
	}
	return &p, nil
}

// SaveProject pushes a project to the controller (POST /api/v1/project/:id).
// The controller validates that p.ID matches the URL parameter, so callers
// must ensure they line up.
func (c *Controller) SaveProject(ctx context.Context, id string, p *Project) error {
	if p == nil {
		return errors.New("controller SaveProject: nil project")
	}
	if p.ID == "" {
		p.ID = id
	}
	if p.ID != id {
		return fmt.Errorf("controller SaveProject: id mismatch (%q vs %q)", p.ID, id)
	}
	clean := sanitizeProjectForController(*p)
	_, err := c.do(ctx, http.MethodPost, "/api/v1/project/"+id, &clean)
	return err
}

/* ------------------------------ Flow ----------------------------- */

// ValidateFlow asks the controller to validate a flow + tasks bundle
// (POST /api/v1/flow/validate). The controller always replies 200 even
// for invalid flows — callers must inspect `Errors`.
func (c *Controller) ValidateFlow(ctx context.Context, flow Flow, tasks []Task) (*ValidationResult, error) {
	body, err := c.do(ctx, http.MethodPost, "/api/v1/flow/validate", ValidateRequest{
		Flow:  sanitizeFlowForController(flow),
		Tasks: tasks,
	})
	if err != nil {
		return nil, err
	}
	var result ValidationResult
	if err := json.Unmarshal(body, &result); err != nil {
		return nil, fmt.Errorf("controller POST flow/validate: parse: %w", err)
	}
	return &result, nil
}

// TestFlow runs a flow with inline tasks (POST /api/v1/flow/test).
// This is the workhorse used by the editor's "Run" button.
func (c *Controller) TestFlow(ctx context.Context, flow Flow, tasks []Task) (*FlowRun, error) {
	body, err := c.do(ctx, http.MethodPost, "/api/v1/flow/test", TestFlowRequest{
		Flow:  sanitizeFlowForController(flow),
		Tasks: tasks,
	})
	if err != nil {
		return nil, err
	}
	var run FlowRun
	if err := json.Unmarshal(body, &run); err != nil {
		return nil, fmt.Errorf("controller POST flow/test: parse: %w", err)
	}
	return &run, nil
}

// GetFlowStatus polls a run by ID (GET /api/v1/flow/status/:id).
func (c *Controller) GetFlowStatus(ctx context.Context, runID string) (*FlowRun, error) {
	body, err := c.do(ctx, http.MethodGet, "/api/v1/flow/status/"+runID, nil)
	if err != nil {
		return nil, err
	}
	var run FlowRun
	if err := json.Unmarshal(body, &run); err != nil {
		return nil, fmt.Errorf("controller GET flow/status: parse: %w", err)
	}
	return &run, nil
}

// RunNamedFlow triggers a flow that's already saved on the controller as
// part of a project (POST /api/v1/project/:id/flows/:name).
func (c *Controller) RunNamedFlow(ctx context.Context, projectID, flowName string) (*FlowRun, error) {
	path := "/api/v1/project/" + projectID + "/flows/" + flowName
	body, err := c.do(ctx, http.MethodPost, path, nil)
	if err != nil {
		return nil, err
	}
	var run FlowRun
	if err := json.Unmarshal(body, &run); err != nil {
		return nil, fmt.Errorf("controller POST flow/run: parse: %w", err)
	}
	return &run, nil
}

/* ----------------------------- helpers --------------------------- */

// do performs an HTTP request and decodes the body. Returns the raw
// body on success (status 2xx). Wraps non-2xx responses as
// *ControllerError.
func (c *Controller) do(ctx context.Context, method, path string, body any) ([]byte, error) {
	url := c.BaseURL + path
	op := method + " " + path

	var reader io.Reader
	if body != nil {
		buf, err := json.Marshal(body)
		if err != nil {
			return nil, fmt.Errorf("controller %s: encode: %w", op, err)
		}
		reader = bytes.NewReader(buf)
	}

	req, err := http.NewRequestWithContext(ctx, method, url, reader)
	if err != nil {
		return nil, fmt.Errorf("controller %s: build request: %w", op, err)
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	req.Header.Set("Accept", "application/json")

	resp, err := c.HTTP.Do(req)
	if err != nil {
		return nil, fmt.Errorf("controller %s: %w", op, err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("controller %s: read body: %w", op, err)
	}

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, &ControllerError{
			Status: resp.StatusCode,
			Body:   strings.TrimSpace(string(respBody)),
			Op:     op,
		}
	}
	return respBody, nil
}

// sanitizeFlowForController strips port entries with an empty `Edge`
// from each step's Inputs/Outputs before the flow crosses into the
// controller.
//
// Why this exists: the editor keeps a placeholder `{Name, Edge: ""}`
// entry for every port the user hasn't wired yet, so the inspector
// and canvas can render the empty row + handle. The controller's
// runtime contract has no use for those placeholders — and worse, its
// cycle detector keys its dependency graph on edge names, so two
// unwired ports across different steps both register as
// producers/consumers of the empty edge `""` and the topological
// sort flags it as a self-loop / cycle.
//
// Stripping empty entries here loses no semantic information: the
// controller's "required port not bound" validator (NODE_002 etc.)
// works the same whether a port is absent or present-with-empty-edge,
// because it iterates the *task's* required ports and checks the
// step for a non-empty binding either way.
//
// We make a defensive deep-ish copy so the caller's original value
// (held by the BFF handler / file store) keeps its placeholders for
// future renders.
func sanitizeFlowForController(flow Flow) Flow {
	if len(flow.Steps) == 0 {
		return flow
	}
	steps := make([]Step, len(flow.Steps))
	for i, s := range flow.Steps {
		s.Inputs = filterBoundPorts(s.Inputs)
		s.Outputs = filterBoundPorts(s.Outputs)
		steps[i] = s
	}
	flow.Steps = steps
	return flow
}

// sanitizeProjectForController applies sanitizeFlowForController to
// every flow in the project. Used by SaveProject (publish) since the
// controller may run cycle detection on save as well as on
// /flow/validate.
func sanitizeProjectForController(p Project) Project {
	if len(p.Flows) == 0 {
		return p
	}
	flows := make([]Flow, len(p.Flows))
	for i, f := range p.Flows {
		flows[i] = sanitizeFlowForController(f)
	}
	p.Flows = flows
	return p
}

// filterBoundPorts returns the subset of ports that have a non-empty
// `Edge`. Returns the input slice unchanged when nothing needs
// stripping so we avoid spurious allocations for the common case
// (every port wired up).
func filterBoundPorts(ports []StepEdge) []StepEdge {
	if len(ports) == 0 {
		return ports
	}
	allBound := true
	for _, p := range ports {
		if p.Edge == "" {
			allBound = false
			break
		}
	}
	if allBound {
		return ports
	}
	out := make([]StepEdge, 0, len(ports))
	for _, p := range ports {
		if p.Edge == "" {
			continue
		}
		out = append(out, p)
	}
	return out
}
