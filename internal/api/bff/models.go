// Package bff hosts the backend-for-frontend layer described in
// `02-abstraction-layer.md`. It is intentionally separate from the
// existing template `handlers` package so the boundary stays clear:
//
//   - The frontend talks ONLY to /bff/* routes here.
//   - This package proxies/decorates calls to the real Pupload
//     controller once it exists. For now it serves stubbed data and
//     persists drafts/layouts to a local file store.
//
// JSON field names use PascalCase to mirror Go model conventions and
// the Layer 1 types in `frontend/src/types/pupload.ts`.
//
// TODO(wire): when the real `internal/models` lands, replace these
//
//	local copies with imports from that package.
package bff

import "encoding/json"

/* ----------------------------- Flow ------------------------------ */

type Flow struct {
	Name            string       `json:"Name"`
	Timeout         string       `json:"Timeout,omitempty"`
	Stores          []StoreInput `json:"Stores"`
	DefaultDataWell *DataWell    `json:"DefaultDataWell,omitempty"`
	DataWells       []DataWell   `json:"DataWells"`
	Steps           []Step       `json:"Steps"`
}

type Step struct {
	ID      string     `json:"ID"`
	Uses    string     `json:"Uses"`
	Inputs  []StepEdge `json:"Inputs"`
	Outputs []StepEdge `json:"Outputs"`
	Flags   []StepFlag `json:"Flags"`
	Command string     `json:"Command"`
}

type StepEdge struct {
	Name string `json:"Name"`
	Edge string `json:"Edge"`
}

type StepFlag struct {
	Name  string `json:"Name"`
	Value string `json:"Value"`
}

/* ----------------------------- Stores ---------------------------- */

type StoreInput struct {
	Name   string         `json:"Name"`
	Type   string         `json:"Type"`
	Params map[string]any `json:"Params"`
}

/* ---------------------------- DataWells -------------------------- */

type DataWell struct {
	Edge     string            `json:"Edge"`
	Store    string            `json:"Store"`
	Source   string            `json:"Source,omitempty"`
	Key      string            `json:"Key,omitempty"`
	Lifetime *DataWellLifetime `json:"Lifetime,omitempty"`
}

type DataWellLifetime struct {
	TTL string `json:"TTL,omitempty"`
}

/* ----------------------------- Tasks ----------------------------- */

type Task struct {
	Publisher   string         `json:"Publisher"`
	Name        string         `json:"Name"`
	Image       string         `json:"Image"`
	Inputs      []TaskEdgeDef  `json:"Inputs"`
	Outputs     []TaskEdgeDef  `json:"Outputs"`
	Flags       []TaskFlagDef  `json:"Flags"`
	Command     TaskCommandDef `json:"Command"`
	Tier        string         `json:"Tier"`
	MaxAttempts int            `json:"MaxAttempts"`
}

type TaskEdgeDef struct {
	Name        string   `json:"Name"`
	Description string   `json:"Description"`
	Required    bool     `json:"Required"`
	Type        []string `json:"Type"`
}

type TaskFlagDef struct {
	Name        string `json:"Name"`
	Description string `json:"Description"`
	Required    bool   `json:"Required"`
	Type        string `json:"Type"`
	Default     string `json:"Default,omitempty"`
}

type TaskCommandDef struct {
	Name        string `json:"Name"`
	Description string `json:"Description"`
	Exec        string `json:"Exec"`
}

/* ----------------------------- Project --------------------------- */

type Project struct {
	ID           string       `json:"ID"`
	Flows        []Flow       `json:"Flows"`
	Tasks        []Task       `json:"Tasks"`
	GlobalStores []StoreInput `json:"GlobalStores"`
}

/* ---------------------------- Validation ------------------------- */

// ValidationEntry mirrors the controller's `/api/v1/flow/validate`
// response item shape (see `04-controller-api-reference.md`).
// `StepID`/`Edge`/`Store`/`Field` are optional client-side hints that
// the BFF passes through but the controller currently ignores.
type ValidationEntry struct {
	Type        string `json:"Type"` // "ValidationError" | "ValidationWarning"
	Code        string `json:"Code"`
	Name        string `json:"Name"`
	Description string `json:"Description"`
	StepID      string `json:"StepID,omitempty"`
	Edge        string `json:"Edge,omitempty"`
	Store       string `json:"Store,omitempty"`
	Field       string `json:"Field,omitempty"`
}

type ValidationResult struct {
	Errors   []ValidationEntry `json:"Errors"`
	Warnings []ValidationEntry `json:"Warnings"`
}

/* ------------------------------ Run ------------------------------ */

type FlowRun struct {
	ID          string               `json:"ID"`
	StepState   map[string]StepState `json:"StepState"`
	Status      string               `json:"Status"`
	Artifacts   map[string]Artifact  `json:"Artifacts"`
	WaitingURLs []WaitingURL         `json:"WaitingURLs"`
	StartedAt   string               `json:"StartedAt"`
}

type StepState struct {
	Status      string      `json:"Status"`
	Logs        []LogRecord `json:"Logs"`
	Error       string      `json:"Error"`
	Attempt     int         `json:"Attempt"`
	MaxAttempts int         `json:"MaxAttempts"`
}

type LogRecord struct {
	Timestamp string `json:"Timestamp"`
	Level     string `json:"Level"`
	Message   string `json:"Message"`
}

// Artifact mirrors the controller's artifact descriptor — see
// `04-controller-api-reference.md` (WaitingURLs / Artifacts sections).
// MimeType is sent by the worker once data lands; not always populated.
type Artifact struct {
	StoreName  string `json:"StoreName"`
	ObjectName string `json:"ObjectName"`
	EdgeName   string `json:"EdgeName"`
	MimeType   string `json:"MimeType,omitempty"`
}

// WaitingURL is the upload-pending shape returned by the controller in
// `FlowRun.WaitingURLs`. The client must PUT data to `PutURL` before the
// controller will move the flow forward.
type WaitingURL struct {
	Artifact Artifact `json:"Artifact"`
	PutURL   string   `json:"PutURL"`
	TTL      string   `json:"TTL,omitempty"`
}

/* -------------------------- BFF-only types ----------------------- */

type XY struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
}

type CanvasLayout struct {
	FlowName          string        `json:"flowName"`
	NodePositions     map[string]XY `json:"nodePositions"`
	DataWellPositions map[string]XY `json:"datawellPositions"`
	Zoom              float64       `json:"zoom"`
	Offset            XY            `json:"offset"`
}

type EnrichedProject struct {
	Project       Project                 `json:"project"`
	Layouts       map[string]CanvasLayout `json:"layouts"`
	PublishStatus string                  `json:"publishStatus"`
	// LastPublishedHash is the SHA-256 of the canonical JSON of
	// `Project` at the moment of the most recent successful publish.
	// PublishStatus is derived from this on every save:
	//   ""               → "not_published"
	//   matches current  → "published"
	//   mismatches       → "unpublished_changes"
	// See `hashProject` / `derivePublishStatus` in handler.go.
	LastPublishedHash string `json:"lastPublishedHash,omitempty"`
}

type AIGenerateRequest struct {
	ProjectID string `json:"projectID"`
	Prompt    string `json:"prompt"`
}

type AIGenerateResult struct {
	Flow     Flow         `json:"flow"`
	Layout   CanvasLayout `json:"layout"`
	NewTasks []Task       `json:"newTasks"`
	Warnings []string     `json:"warnings"`
}

type ValidateRequest struct {
	Flow  Flow   `json:"Flow"`
	Tasks []Task `json:"Tasks"`
}

type TestFlowRequest struct {
	Flow  Flow   `json:"Flow"`
	Tasks []Task `json:"Tasks"`
}

// Marshal helper used in handlers — no functional change, just keeps
// the import alive in case we want stricter encoding settings later.
var _ = json.Marshal
