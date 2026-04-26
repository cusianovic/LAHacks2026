package bff

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"sort"
	"strings"
)

// =====================================================================
// AI flow generator.
//
// Pipeline:
//   1. Build a system prompt from the project's task palette + global
//      stores so Claude can target real task IDs / port names.
//   2. Define a `submit_flow` tool whose input_schema is the JSON
//      shape of `AIGenerateResult`. Force Claude to invoke it via
//      `tool_choice` so the response is always structured JSON.
//   3. Parse + validate the tool_use arguments. Validation enforces:
//        - every Step.Uses references a known task (existing or
//          newly proposed),
//        - every Step input/output edge points at a DataWell on the
//          flow,
//        - DataWell edge names are unique,
//        - no orphan datawells (each is referenced by some step),
//        - flow has at least one step, no duplicate step IDs.
//   4. On validation failure, ask Claude to repair its previous output
//      with the specific errors. Capped at one self-repair round-trip
//      to bound cost.
//   5. If the model didn't supply node positions (or supplied
//      partial ones), run `autoLayout` to drop the rest into a tidy
//      column-by-column DAG layout.
//
// The generator is the single moving part downstream of the HTTP
// handler (`aiGenerate`). Falls back to the hardcoded `SampleAIFlow`
// when the Anthropic client is nil (no API key configured).
// =====================================================================

// generateAIFlow runs the full pipeline above. Returns the validated,
// auto-laid-out result the BFF hands back to the editor.
//
// `currentFlow` and `currentLayout` carry edit-mode context: when both
// are non-nil and `currentFlow.Steps` is non-empty, the generator
// switches the system prompt and user message to ask the model to
// modify the existing flow in place rather than synthesise a new one.
// Position-preservation across the regen happens in `ensureLayout`,
// which keeps any node/well that survived the edit at its prior
// canvas coordinates so the user's manual layout choices aren't
// thrown away on every regen.
//
// Errors:
//   - context.Canceled / DeadlineExceeded — bubbles up as-is.
//   - *AnthropicError — surface from `Messages` after retries.
//   - "ai generator:" wrapped errors — validation failures we couldn't
//     repair, malformed tool arguments, etc. Always safe to log.
func generateAIFlow(
	ctx context.Context,
	client *AnthropicClient,
	project *Project,
	currentFlow *Flow,
	currentLayout *CanvasLayout,
	prompt string,
) (*AIGenerateResult, error) {
	if client == nil {
		return nil, errors.New("ai generator: anthropic client not configured")
	}
	if strings.TrimSpace(prompt) == "" {
		return nil, errors.New("ai generator: empty prompt")
	}

	editMode := currentFlow != nil && len(currentFlow.Steps) > 0

	system := buildSystemPrompt(project, editMode)
	tool := submitFlowTool()
	userMsg := buildUserPrompt(currentFlow, prompt, editMode)

	messages := []Message{userMessage(userMsg)}

	// Up to two attempts: the initial call, plus one repair pass if
	// the structured output fails our validator. Keeps cost bounded
	// while still recovering from the model's most common mistakes
	// (mis-named edges, references to non-existent tasks, etc.).
	const maxRounds = 2
	var (
		lastResult   *AIGenerateResult
		lastWarnings []string
		lastErr      error
	)
	for round := 1; round <= maxRounds; round++ {
		req := MessagesRequest{
			// 8192 is comfortable for ~20-step flows with full layouts.
			// Empirically a step is ~120-180 output tokens; allow some
			// headroom for verbose `NewTasks` definitions.
			MaxTokens:  8192,
			System:     system,
			Messages:   messages,
			Tools:      []Tool{tool},
			ToolChoice: &ToolChoice{Type: "tool", Name: tool.Name},
		}
		resp, err := client.Messages(ctx, req)
		if err != nil {
			return nil, err
		}

		toolUse := resp.FirstToolUse()
		if toolUse == nil {
			// Model returned text only — usually a refusal or a
			// "happy to help, here's some text". Treat as a model
			// error and surface the first text block to the user.
			return nil, fmt.Errorf("ai generator: model did not call submit_flow (text=%q)",
				truncateString(resp.FirstText(), 240))
		}

		raw := toolUse.Input
		result, validationErrs, warnings := parseAndValidate(raw, project)
		lastResult = result
		lastWarnings = append(lastWarnings, warnings...)

		if len(validationErrs) == 0 {
			// In edit mode the frontend's reducer (`HYDRATE_FROM_AI`)
			// matches by flow name to decide replace-vs-append. If the
			// model renamed the flow we'd end up with two flows on the
			// canvas — which is confusing because the user asked to
			// modify the existing one. Force the original name back
			// (and warn so it's visible in the modal), unless the user
			// explicitly asked for a rename in their prompt.
			if editMode && currentFlow != nil && result.Flow.Name != currentFlow.Name {
				result.Warnings = append(result.Warnings, fmt.Sprintf(
					"Model renamed the flow from %q to %q; renamed back to keep the edit in place.",
					currentFlow.Name, result.Flow.Name,
				))
				result.Flow.Name = currentFlow.Name
			}
			// Apply auto-layout only after validation passes; the
			// layout step assumes a well-formed DAG. `previous` is the
			// pre-edit layout so unchanged nodes keep their drag-state.
			ensureLayout(result, currentLayout)
			result.Warnings = append(result.Warnings, lastWarnings...)
			mode := "create"
			if editMode {
				mode = "edit"
			}
			log.Printf("ai generator: ok (mode=%s, model=%s, round=%d, steps=%d, datawells=%d, tokens=%d/%d)",
				mode, client.Model(), round, len(result.Flow.Steps), len(result.Flow.DataWells),
				resp.Usage.InputTokens, resp.Usage.OutputTokens)
			return result, nil
		}

		log.Printf("ai generator: round %d validation failed (%d errors): %v",
			round, len(validationErrs), validationErrs)
		lastErr = fmt.Errorf("ai generator: validation failed: %s", joinErrs(validationErrs))

		if round == maxRounds {
			break
		}

		// Append the model's previous tool call + a synthetic tool
		// result so the repair turn has full conversational context.
		// `tool_result.is_error=true` signals the model that its
		// previous attempt was rejected and needs fixing.
		messages = append(messages,
			assistantToolUseEcho(toolUse),
			userToolResult(toolUse.ID, repairInstructions(validationErrs)),
		)
	}

	// Both rounds failed. Surface a useful error; the handler maps it
	// to a 502 with the message in the body so the modal can render it.
	if lastErr == nil {
		lastErr = errors.New("ai generator: unknown failure")
	}
	if lastResult != nil {
		// Even on failure we return the last attempt's warnings so the
		// handler can log them — but the result itself is nil because
		// we don't want the editor to hydrate from invalid data.
		log.Printf("ai generator: last attempt warnings: %v", lastWarnings)
	}
	return nil, lastErr
}

/* ----------------------------- prompt builder ---------------------- */

// buildSystemPrompt produces the deterministic system message Claude
// sees on every call. It teaches the model the Pupload data shape +
// the JSON keys we expect, then enumerates the task palette so the
// model knows what's available without us having to send the full
// `TaskEdgeDef` blob (which is verbose and would burn input tokens).
//
// `editMode` flips the framing: in edit mode the model is told it's
// modifying an existing flow rather than designing one from scratch,
// and is reminded to preserve unchanged steps and datawells so the
// user's manual canvas layout survives the regen. The current flow
// JSON is shown to the model in `buildUserPrompt`, not here, so this
// prompt stays cache-friendly across calls.
//
// The prompt is intentionally explicit about PascalCase; LLMs default
// to camelCase JSON and the controller would 400 on the resulting
// publish. Keep this in sync with `models.go`.
func buildSystemPrompt(p *Project, editMode bool) string {
	var b strings.Builder
	b.WriteString("You are an expert pipeline architect for Pupload, a tool for ")
	b.WriteString("composing media-processing flows out of pre-built tasks. You ")
	if editMode {
		b.WriteString("modify an existing Flow according to the user's request by ")
		b.WriteString("calling the `submit_flow` tool exactly once with the full ")
		b.WriteString("desired final state of the Flow. Preserve any Steps, ")
		b.WriteString("DataWells, and Stores that the user did not ask to change ")
		b.WriteString("— keep their IDs / Edge names / parameters identical so ")
		b.WriteString("the canvas layout survives. Only add, remove, or modify ")
		b.WriteString("the parts the user described.\n\n")
	} else {
		b.WriteString("turn the user's natural-language description into a structured ")
		b.WriteString("Flow definition by calling the `submit_flow` tool exactly once.\n\n")
	}

	b.WriteString("# Domain model\n\n")
	b.WriteString("A Pupload Flow is a directed acyclic graph of Steps connected by ")
	b.WriteString("DataWells. Each Step is an instance of a Task — a pre-built ")
	b.WriteString("container image with declared Inputs, Outputs, and Flags. ")
	b.WriteString("Tasks are identified by `<Publisher>/<Name>` (e.g. `pupload/encode`).\n\n")

	b.WriteString("Steps consume DataWells via `Inputs` and produce DataWells via ")
	b.WriteString("`Outputs`. Each input/output entry has:\n")
	b.WriteString("  - `Name`: the Task's port name (e.g. `VideoIn`, `VideoOut`).\n")
	b.WriteString("  - `Edge`: the DataWell name on the Flow.\n\n")

	b.WriteString("DataWells live on the Flow and represent persistent storage objects:\n")
	b.WriteString("  - `Edge`: unique name on the flow (the wire it represents).\n")
	b.WriteString("  - `Store`: name of a StoreInput on the flow (or DefaultDataWell).\n")
	b.WriteString("  - `Source`: \"upload\" if user-supplied at runtime, else \"static\".\n")
	b.WriteString("  - `Key`: object path. Use `${RUN_ID}/...` for per-run uniqueness.\n\n")

	b.WriteString("# JSON shape (strict)\n\n")
	b.WriteString("All keys are PascalCase. The `submit_flow` tool's input_schema is ")
	b.WriteString("authoritative — match it exactly. Common mistakes to avoid:\n")
	b.WriteString("  - DO NOT use camelCase keys (`inputs` vs `Inputs`).\n")
	b.WriteString("  - DO NOT invent task names; reuse existing tasks below or add ")
	b.WriteString("    them to `NewTasks` if a new one is genuinely needed.\n")
	b.WriteString("  - DO NOT reference DataWell edges that aren't declared in `DataWells`.\n")
	b.WriteString("  - DO NOT leave Flags empty if a Task lists required flags.\n")
	b.WriteString("  - DO emit a Flow `Stores` array (use `[]` if all wells use the ")
	b.WriteString("    DefaultDataWell).\n\n")

	b.WriteString("# Available tasks\n\n")
	if len(p.Tasks) == 0 {
		b.WriteString("(none — propose new tasks via `NewTasks` if needed)\n\n")
	} else {
		b.WriteString(formatTaskCatalog(p.Tasks))
		b.WriteString("\n")
	}

	if len(p.GlobalStores) > 0 {
		b.WriteString("# Available global stores\n\n")
		for _, s := range p.GlobalStores {
			fmt.Fprintf(&b, "- `%s` (type: %s)\n", s.Name, s.Type)
		}
		b.WriteString("\n")
	}

	b.WriteString("# Layout (optional)\n\n")
	b.WriteString("If you supply node positions, use a left-to-right DAG layout: ")
	b.WriteString("upload datawells on the far left, terminal outputs on the far right, ")
	b.WriteString("steps in topological columns between them. Column spacing ~280px, ")
	b.WriteString("row spacing ~160px. If you skip positions, the BFF will lay out ")
	b.WriteString("the graph automatically.\n\n")

	b.WriteString("# Process\n\n")
	if editMode {
		b.WriteString("1. Read the user prompt and the current flow shown below it.\n")
		b.WriteString("2. Decide which Steps / DataWells / Stores need to change.\n")
		b.WriteString("3. Copy unchanged Steps and DataWells verbatim — same IDs, ")
		b.WriteString("same Edge names, same Flag values.\n")
		b.WriteString("4. Apply the requested edits. Reuse existing Edge names and ")
		b.WriteString("Step IDs whenever possible to minimise canvas churn.\n")
		b.WriteString("5. Keep `Flow.Name` identical to the current flow's Name so ")
		b.WriteString("the editor replaces the existing flow in place.\n")
		b.WriteString("6. Call `submit_flow` with the full desired final state. ")
		b.WriteString("Do not reply in plain text.\n")
	} else {
		b.WriteString("1. Read the user prompt.\n")
		b.WriteString("2. Pick existing tasks where possible.\n")
		b.WriteString("3. Define the DataWells the steps connect through.\n")
		b.WriteString("4. Wire Inputs/Outputs by edge name.\n")
		b.WriteString("5. Set sensible Flag values for any required flags.\n")
		b.WriteString("6. Call `submit_flow`. Do not reply in plain text.\n")
	}

	return b.String()
}

// formatTaskCatalog renders a compact summary of each task — name,
// description if available, port names with types, and required flags
// — into the system prompt so the model can target real ports without
// us having to ship the full `TaskEdgeDef` blob.
func formatTaskCatalog(tasks []Task) string {
	// Sorted output keeps the prompt cache-friendly across calls.
	sorted := make([]Task, len(tasks))
	copy(sorted, tasks)
	sort.SliceStable(sorted, func(i, j int) bool {
		a := sorted[i].Publisher + "/" + sorted[i].Name
		b := sorted[j].Publisher + "/" + sorted[j].Name
		return a < b
	})

	var b strings.Builder
	for _, t := range sorted {
		fmt.Fprintf(&b, "## `%s/%s`\n", t.Publisher, t.Name)
		if t.Command.Description != "" {
			fmt.Fprintf(&b, "%s\n", t.Command.Description)
		}
		if len(t.Inputs) > 0 {
			b.WriteString("  Inputs:")
			for _, in := range t.Inputs {
				fmt.Fprintf(&b, " %s", in.Name)
				if in.Required {
					b.WriteString("(required)")
				}
				if len(in.Type) > 0 {
					fmt.Fprintf(&b, "[%s]", strings.Join(in.Type, ","))
				}
			}
			b.WriteString("\n")
		}
		if len(t.Outputs) > 0 {
			b.WriteString("  Outputs:")
			for _, out := range t.Outputs {
				fmt.Fprintf(&b, " %s", out.Name)
				if len(out.Type) > 0 {
					fmt.Fprintf(&b, "[%s]", strings.Join(out.Type, ","))
				}
			}
			b.WriteString("\n")
		}
		if len(t.Flags) > 0 {
			b.WriteString("  Flags:")
			for _, f := range t.Flags {
				fmt.Fprintf(&b, " %s", f.Name)
				if f.Required {
					b.WriteString("(required)")
				}
				if f.Default != "" {
					fmt.Fprintf(&b, "=%s", f.Default)
				}
			}
			b.WriteString("\n")
		}
		b.WriteString("\n")
	}
	return b.String()
}

// buildUserPrompt wraps the operator's free-text prompt with a final
// reminder + (in edit mode) the current flow JSON the model should
// modify. Repeating the PascalCase constraint at the user-message
// level dramatically reduces format drift on weaker models — and even
// Sonnet occasionally slips without it.
//
// In edit mode the current flow is injected as a fenced JSON block so
// the model has the full structural context (every Step, DataWell,
// Store) without having to reconstruct it. The block is marshalled
// with indent so the model's tokenizer treats each field on its own
// line — empirically this makes "preserve unchanged fields" work
// substantially better than a single-line dump.
func buildUserPrompt(currentFlow *Flow, prompt string, editMode bool) string {
	var b strings.Builder
	b.WriteString(strings.TrimSpace(prompt))
	b.WriteString("\n\n")
	if editMode && currentFlow != nil {
		b.WriteString("# Current flow (modify this, don't replace it)\n\n")
		b.WriteString("```json\n")
		if blob, err := json.MarshalIndent(currentFlow, "", "  "); err == nil {
			b.Write(blob)
		} else {
			// Fall back to a plain-text marker so the model still sees
			// it's in edit mode even if marshal somehow fails.
			b.WriteString("(failed to serialise current flow)")
		}
		b.WriteString("\n```\n\n")
	}
	b.WriteString("Reminder: call submit_flow with strict PascalCase JSON. ")
	b.WriteString("Use real task IDs from the catalog; only add to NewTasks ")
	b.WriteString("when no existing task fits.")
	if editMode {
		b.WriteString(" Keep `Flow.Name` identical to the current flow's Name. ")
		b.WriteString("Preserve unchanged Steps / DataWells / Stores verbatim ")
		b.WriteString("(same IDs, Edge names, and Flag values).")
	}
	return b.String()
}

/* ----------------------------- tool schema ------------------------- */

// submitFlowTool returns the tool definition Claude must invoke. The
// schema mirrors `AIGenerateResult` (Flow + Layout + NewTasks + Warnings).
// Kept hand-rolled rather than reflection-generated so we control:
//   - which fields are required vs optional,
//   - the description strings the model sees (these are the most
//     important UI for steering output quality),
//   - the discriminated unions (e.g. DataWell.Source enum).
//
// Keep field names in sync with `models.go`. Anthropic does not enforce
// the schema strictly — the model can technically still produce drift
// — but in practice forcing tool_choice + a tight schema is reliable.
func submitFlowTool() Tool {
	return Tool{
		Name: "submit_flow",
		Description: "Submit the generated Pupload Flow. Call this exactly once " +
			"with the structured Flow definition that fulfils the user's prompt. " +
			"All field names use PascalCase.",
		InputSchema: json.RawMessage(submitFlowSchema),
	}
}

const submitFlowSchema = `{
  "type": "object",
  "additionalProperties": false,
  "required": ["Flow"],
  "properties": {
    "Flow": {
      "type": "object",
      "additionalProperties": false,
      "required": ["Name", "Stores", "DataWells", "Steps"],
      "properties": {
        "Name": { "type": "string", "description": "Short kebab-case identifier for the flow (e.g. 'adaptive-video')." },
        "Timeout": { "type": "string", "description": "Optional Go duration string (e.g. '10m')." },
        "Stores": {
          "type": "array",
          "items": {
            "type": "object",
            "additionalProperties": false,
            "required": ["Name", "Type", "Params"],
            "properties": {
              "Name": { "type": "string" },
              "Type": { "type": "string", "description": "Store driver (e.g. 's3', 'memory')." },
              "Params": { "type": "object", "additionalProperties": true }
            }
          }
        },
        "DefaultDataWell": {
          "type": "object",
          "description": "Optional fallback for any DataWell that does not specify a Store.",
          "additionalProperties": false,
          "required": ["Store"],
          "properties": {
            "Edge": { "type": "string" },
            "Store": { "type": "string" },
            "Source": { "type": "string", "enum": ["upload", "static"] },
            "Key": { "type": "string" }
          }
        },
        "DataWells": {
          "type": "array",
          "items": {
            "type": "object",
            "additionalProperties": false,
            "required": ["Edge", "Store"],
            "properties": {
              "Edge": { "type": "string", "description": "Unique edge name on the flow." },
              "Store": { "type": "string" },
              "Source": { "type": "string", "enum": ["upload", "static"], "description": "'upload' if user-supplied at runtime; otherwise 'static'." },
              "Key": { "type": "string", "description": "Object path; use ${RUN_ID}/... for per-run uniqueness." }
            }
          }
        },
        "Steps": {
          "type": "array",
          "minItems": 1,
          "items": {
            "type": "object",
            "additionalProperties": false,
            "required": ["ID", "Uses", "Inputs", "Outputs", "Flags", "Command"],
            "properties": {
              "ID": { "type": "string", "description": "Unique step ID within the flow." },
              "Uses": { "type": "string", "description": "<Publisher>/<Name> of the task this step instantiates." },
              "Command": { "type": "string", "description": "Command name on the Task (often 'encode', 'thumbnail', etc.)." },
              "Inputs": {
                "type": "array",
                "items": {
                  "type": "object",
                  "additionalProperties": false,
                  "required": ["Name", "Edge"],
                  "properties": {
                    "Name": { "type": "string" },
                    "Edge": { "type": "string" }
                  }
                }
              },
              "Outputs": {
                "type": "array",
                "items": {
                  "type": "object",
                  "additionalProperties": false,
                  "required": ["Name", "Edge"],
                  "properties": {
                    "Name": { "type": "string" },
                    "Edge": { "type": "string" }
                  }
                }
              },
              "Flags": {
                "type": "array",
                "items": {
                  "type": "object",
                  "additionalProperties": false,
                  "required": ["Name", "Value"],
                  "properties": {
                    "Name": { "type": "string" },
                    "Value": { "type": "string" }
                  }
                }
              }
            }
          }
        }
      }
    },
    "Layout": {
      "type": "object",
      "description": "Optional node positions; the BFF will auto-lay-out anything missing.",
      "additionalProperties": false,
      "required": ["FlowName", "NodePositions", "DataWellPositions"],
      "properties": {
        "FlowName": { "type": "string" },
        "Zoom": { "type": "number" },
        "Offset": {
          "type": "object",
          "additionalProperties": false,
          "required": ["x", "y"],
          "properties": {
            "x": { "type": "number" },
            "y": { "type": "number" }
          }
        },
        "NodePositions": {
          "type": "object",
          "additionalProperties": {
            "type": "object",
            "additionalProperties": false,
            "required": ["x", "y"],
            "properties": { "x": { "type": "number" }, "y": { "type": "number" } }
          }
        },
        "DataWellPositions": {
          "type": "object",
          "additionalProperties": {
            "type": "object",
            "additionalProperties": false,
            "required": ["x", "y"],
            "properties": { "x": { "type": "number" }, "y": { "type": "number" } }
          }
        }
      }
    },
    "NewTasks": {
      "type": "array",
      "description": "Tasks the flow needs that aren't in the existing palette. Leave empty if all steps reuse known tasks.",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": ["Publisher", "Name", "Image", "Inputs", "Outputs", "Flags", "Command", "Tier", "MaxAttempts"],
        "properties": {
          "Publisher": { "type": "string" },
          "Name": { "type": "string" },
          "Image": { "type": "string", "description": "OCI image reference, e.g. 'ghcr.io/example/foo:latest'." },
          "Tier": { "type": "string", "enum": ["cpu", "gpu"] },
          "MaxAttempts": { "type": "integer", "minimum": 1 },
          "Inputs": {
            "type": "array",
            "items": {
              "type": "object",
              "additionalProperties": false,
              "required": ["Name", "Description", "Required", "Type"],
              "properties": {
                "Name": { "type": "string" },
                "Description": { "type": "string" },
                "Required": { "type": "boolean" },
                "Type": { "type": "array", "items": { "type": "string" } }
              }
            }
          },
          "Outputs": {
            "type": "array",
            "items": {
              "type": "object",
              "additionalProperties": false,
              "required": ["Name", "Description", "Required", "Type"],
              "properties": {
                "Name": { "type": "string" },
                "Description": { "type": "string" },
                "Required": { "type": "boolean" },
                "Type": { "type": "array", "items": { "type": "string" } }
              }
            }
          },
          "Flags": {
            "type": "array",
            "items": {
              "type": "object",
              "additionalProperties": false,
              "required": ["Name", "Description", "Required", "Type"],
              "properties": {
                "Name": { "type": "string" },
                "Description": { "type": "string" },
                "Required": { "type": "boolean" },
                "Type": { "type": "string" },
                "Default": { "type": "string" }
              }
            }
          },
          "Command": {
            "type": "object",
            "additionalProperties": false,
            "required": ["Name", "Description", "Exec"],
            "properties": {
              "Name": { "type": "string" },
              "Description": { "type": "string" },
              "Exec": { "type": "string" }
            }
          }
        }
      }
    },
    "Warnings": {
      "type": "array",
      "description": "Optional notes for the operator (assumptions, missing details, etc.).",
      "items": { "type": "string" }
    }
  }
}`

/* ----------------------------- validation -------------------------- */

// parseAndValidate decodes the model's tool_use arguments and runs the
// constraints the schema can't express on its own. Returns:
//   - the parsed result (always non-nil so the repair turn can echo it),
//   - the list of validation errors (empty == success),
//   - non-fatal warnings the BFF should append to the final response.
func parseAndValidate(raw json.RawMessage, project *Project) (*AIGenerateResult, []string, []string) {
	result := &AIGenerateResult{
		NewTasks: []Task{},
		Warnings: []string{},
	}
	if err := json.Unmarshal(raw, result); err != nil {
		return result, []string{fmt.Sprintf("could not parse tool arguments as JSON: %v", err)}, nil
	}

	var (
		errs     []string
		warnings []string
	)

	flow := &result.Flow
	if strings.TrimSpace(flow.Name) == "" {
		errs = append(errs, "Flow.Name is required")
	}
	if len(flow.Steps) == 0 {
		errs = append(errs, "Flow.Steps must contain at least one step")
	}

	// DataWell edges → unique, non-empty.
	wellByEdge := map[string]int{}
	for i, w := range flow.DataWells {
		if strings.TrimSpace(w.Edge) == "" {
			errs = append(errs, fmt.Sprintf("DataWells[%d].Edge is required", i))
			continue
		}
		if _, dup := wellByEdge[w.Edge]; dup {
			errs = append(errs, fmt.Sprintf("DataWell edge %q is duplicated", w.Edge))
			continue
		}
		wellByEdge[w.Edge] = i
		if strings.TrimSpace(w.Store) == "" && (flow.DefaultDataWell == nil || flow.DefaultDataWell.Store == "") {
			errs = append(errs, fmt.Sprintf("DataWell %q has no Store and no DefaultDataWell.Store fallback", w.Edge))
		}
	}

	// Step references must resolve.
	knownTasks := taskIndex(project.Tasks, result.NewTasks)
	stepIDs := map[string]bool{}
	usedEdges := map[string]bool{}
	for i, s := range flow.Steps {
		if strings.TrimSpace(s.ID) == "" {
			errs = append(errs, fmt.Sprintf("Steps[%d].ID is required", i))
			continue
		}
		if stepIDs[s.ID] {
			errs = append(errs, fmt.Sprintf("duplicate Step.ID %q", s.ID))
			continue
		}
		stepIDs[s.ID] = true

		taskKey := s.Uses
		if _, ok := knownTasks[taskKey]; !ok {
			errs = append(errs, fmt.Sprintf("Step %q uses unknown task %q (not in catalog and not in NewTasks)", s.ID, taskKey))
		}

		// Edges referenced by Inputs/Outputs must resolve to a DataWell
		// (or to the DefaultDataWell, which is identified by edge name
		// in the schema's optional `Edge` field).
		for j, in := range s.Inputs {
			if strings.TrimSpace(in.Edge) == "" {
				errs = append(errs, fmt.Sprintf("Step %q Inputs[%d].Edge is required", s.ID, j))
				continue
			}
			if _, ok := wellByEdge[in.Edge]; !ok {
				errs = append(errs, fmt.Sprintf("Step %q references unknown input edge %q", s.ID, in.Edge))
			}
			usedEdges[in.Edge] = true
		}
		for j, out := range s.Outputs {
			if strings.TrimSpace(out.Edge) == "" {
				errs = append(errs, fmt.Sprintf("Step %q Outputs[%d].Edge is required", s.ID, j))
				continue
			}
			if _, ok := wellByEdge[out.Edge]; !ok {
				errs = append(errs, fmt.Sprintf("Step %q references unknown output edge %q", s.ID, out.Edge))
			}
			usedEdges[out.Edge] = true
		}
	}

	// Orphan datawells are warnings, not errors. The user might have a
	// reason for an unconnected sink. We surface them so the operator
	// can clean up if it was unintentional.
	for edge := range wellByEdge {
		if !usedEdges[edge] {
			warnings = append(warnings, fmt.Sprintf("DataWell %q is not referenced by any step", edge))
		}
	}

	return result, errs, warnings
}

// taskIndex builds a `<Publisher>/<Name>` → bool lookup combining the
// project's existing palette with any tasks the model proposed. Used
// by validation to catch dangling Step.Uses references.
func taskIndex(existing []Task, proposed []Task) map[string]bool {
	idx := make(map[string]bool, len(existing)+len(proposed))
	for _, t := range existing {
		idx[t.Publisher+"/"+t.Name] = true
	}
	for _, t := range proposed {
		idx[t.Publisher+"/"+t.Name] = true
	}
	return idx
}

// repairInstructions builds the user-tool-result message asking the
// model to fix specific validation errors. Lists each error inline so
// the model has actionable feedback rather than a generic "try again".
func repairInstructions(errs []string) string {
	var b strings.Builder
	b.WriteString("Your previous submit_flow call had the following validation errors:\n")
	for _, e := range errs {
		fmt.Fprintf(&b, "  - %s\n", e)
	}
	b.WriteString("\nCall submit_flow again with a corrected payload. ")
	b.WriteString("Keep what was correct, fix only the listed issues, ")
	b.WriteString("and do not reply in plain text.")
	return b.String()
}

func joinErrs(errs []string) string {
	return strings.Join(errs, "; ")
}

/* ------------------------------ layout ----------------------------- */

const (
	autoLayoutColumnX = 280.0
	autoLayoutRowY    = 160.0
	autoLayoutMarginX = 40.0
	autoLayoutMarginY = 80.0
	autoLayoutZoom    = 1.0
)

// ensureLayout fills in any missing positions on the result's Layout.
// If the model didn't supply a Layout at all we synthesize one from
// scratch. If it supplied a partial one we keep its positions and
// only fill the gaps.
//
// `previous` is the layout the user was looking at before the regen.
// In edit-mode, any Step or DataWell that survived the regen at the
// same ID/Edge keeps its previous canvas coordinates so the user's
// manual placements aren't reset on every "add a thumbnail step"
// turn. Position resolution order, highest priority first:
//
//  1. The model's explicit Layout (if any field is populated for the
//     node) — the model gets to override on purpose.
//  2. The previous layout entry for the same ID/Edge — preserves
//     user-drag state.
//  3. `autoLayout` for anything still missing — placed by topological
//     depth so brand-new nodes land near their dependencies.
func ensureLayout(result *AIGenerateResult, previous *CanvasLayout) {
	flow := result.Flow
	auto := autoLayout(flow)

	// If the model didn't emit a Layout block at all, start from the
	// auto layout and overwrite from `previous` below.
	if result.Layout.FlowName == "" {
		result.Layout = CanvasLayout{
			FlowName:          flow.Name,
			Zoom:              autoLayoutZoom,
			Offset:            XY{X: 0, Y: 0},
			NodePositions:     map[string]XY{},
			DataWellPositions: map[string]XY{},
		}
	}
	if result.Layout.NodePositions == nil {
		result.Layout.NodePositions = map[string]XY{}
	}
	if result.Layout.DataWellPositions == nil {
		result.Layout.DataWellPositions = map[string]XY{}
	}
	if result.Layout.FlowName == "" {
		result.Layout.FlowName = flow.Name
	}
	if result.Layout.Zoom == 0 {
		result.Layout.Zoom = autoLayoutZoom
	}

	// Resolve each present-in-flow node/well in priority order.
	stepIDs := map[string]bool{}
	for _, s := range flow.Steps {
		stepIDs[s.ID] = true
	}
	wellEdges := map[string]bool{}
	for _, w := range flow.DataWells {
		wellEdges[w.Edge] = true
	}

	// Step positions.
	for id := range stepIDs {
		if _, hasModel := result.Layout.NodePositions[id]; hasModel {
			continue // model wins
		}
		if previous != nil {
			if p, ok := previous.NodePositions[id]; ok {
				result.Layout.NodePositions[id] = p
				continue
			}
		}
		if p, ok := auto.NodePositions[id]; ok {
			result.Layout.NodePositions[id] = p
		}
	}
	// DataWell positions.
	for edge := range wellEdges {
		if _, hasModel := result.Layout.DataWellPositions[edge]; hasModel {
			continue
		}
		if previous != nil {
			if p, ok := previous.DataWellPositions[edge]; ok {
				result.Layout.DataWellPositions[edge] = p
				continue
			}
		}
		if p, ok := auto.DataWellPositions[edge]; ok {
			result.Layout.DataWellPositions[edge] = p
		}
	}

	// Drop positions for nodes that no longer exist in the flow — they
	// shouldn't survive on the canvas and the frontend reducer would
	// ignore them anyway, but a clean layout is friendlier to debug.
	for id := range result.Layout.NodePositions {
		if !stepIDs[id] {
			delete(result.Layout.NodePositions, id)
		}
	}
	for edge := range result.Layout.DataWellPositions {
		if !wellEdges[edge] {
			delete(result.Layout.DataWellPositions, edge)
		}
	}

	// Carry over zoom/offset from the previous canvas state when the
	// model didn't pick its own. Keeps the viewport stable across
	// regens — the user doesn't get bounced to (0,0) every edit.
	if previous != nil {
		if result.Layout.Zoom == 0 || result.Layout.Zoom == autoLayoutZoom {
			if previous.Zoom != 0 {
				result.Layout.Zoom = previous.Zoom
			}
		}
		if result.Layout.Offset == (XY{}) {
			result.Layout.Offset = previous.Offset
		}
	}
}

// autoLayout assigns each node (Step or DataWell) a column based on
// topological depth, then stacks nodes within a column vertically by
// insertion order. The algorithm is intentionally simple — we don't
// try to minimize edge crossings — because the editor lets the user
// drag nodes after the fact and a crossing-minimal layout would be
// jarring on every regen.
//
// Algorithm:
//  1. depth[edge] = 0 for any DataWell with no producer step (uploads
//     and unwired statics), else max(producer.depth) + 1.
//  2. depth[step] = max(input_well.depth) + 1; default 0 if no inputs.
//  3. column position x = depth * autoLayoutColumnX + autoLayoutMarginX.
//  4. row position y = (sequence index within its column) * autoLayoutRowY
//     + autoLayoutMarginY.
//
// Tested informally against the demo seed: produces a layout that's
// equivalent to the hand-tuned `SampleAIFlow` positions to within a
// few px.
func autoLayout(flow Flow) CanvasLayout {
	// Build producer set: which step produces which DataWell edge.
	producerOfEdge := map[string]string{}
	for _, s := range flow.Steps {
		for _, out := range s.Outputs {
			producerOfEdge[out.Edge] = s.ID
		}
	}
	// Quick lookup of step by ID so depth resolution can recurse.
	stepByID := map[string]Step{}
	for _, s := range flow.Steps {
		stepByID[s.ID] = s
	}
	// DataWells indexed by edge.
	wellByEdge := map[string]DataWell{}
	for _, w := range flow.DataWells {
		wellByEdge[w.Edge] = w
	}

	// Memoized depth. -1 = not yet computed; -2 = currently being
	// computed (cycle marker — shouldn't happen for valid DAGs but we
	// guard anyway so a malformed flow doesn't hang the layout).
	const (
		notComputed = -1
		computing   = -2
	)
	stepDepth := map[string]int{}
	wellDepth := map[string]int{}
	for id := range stepByID {
		stepDepth[id] = notComputed
	}
	for edge := range wellByEdge {
		wellDepth[edge] = notComputed
	}

	var depthOfWell func(edge string) int
	var depthOfStep func(id string) int

	depthOfWell = func(edge string) int {
		if d, ok := wellDepth[edge]; ok && d != notComputed {
			if d == computing {
				return 0
			}
			return d
		}
		wellDepth[edge] = computing
		producer, hasProducer := producerOfEdge[edge]
		if !hasProducer {
			wellDepth[edge] = 0
			return 0
		}
		d := depthOfStep(producer) + 1
		wellDepth[edge] = d
		return d
	}

	depthOfStep = func(id string) int {
		if d, ok := stepDepth[id]; ok && d != notComputed {
			if d == computing {
				return 0
			}
			return d
		}
		stepDepth[id] = computing
		s := stepByID[id]
		max := -1
		for _, in := range s.Inputs {
			if d := depthOfWell(in.Edge); d > max {
				max = d
			}
		}
		d := max + 1
		if d < 0 {
			d = 0
		}
		stepDepth[id] = d
		return d
	}

	// Trigger computation for every node.
	for id := range stepByID {
		depthOfStep(id)
	}
	for edge := range wellByEdge {
		depthOfWell(edge)
	}

	// Pack into columns. Insertion order within a column is stable
	// using the slice order of `flow.Steps` / `flow.DataWells` so
	// regenerating with the same model output is deterministic.
	type colMember struct {
		kind string // "step" | "well"
		key  string
	}
	colMembers := map[int][]colMember{}
	maxDepth := 0
	for _, s := range flow.Steps {
		d := stepDepth[s.ID]
		colMembers[d] = append(colMembers[d], colMember{kind: "step", key: s.ID})
		if d > maxDepth {
			maxDepth = d
		}
	}
	// Terminal datawells (the producer's column + 1) get pushed one
	// column further so they sit to the right of their producer step.
	// Source datawells stay at depth 0 (or wherever wellDepth landed).
	for _, w := range flow.DataWells {
		d := wellDepth[w.Edge]
		colMembers[d] = append(colMembers[d], colMember{kind: "well", key: w.Edge})
		if d > maxDepth {
			maxDepth = d
		}
	}

	nodes := map[string]XY{}
	wells := map[string]XY{}
	for col := 0; col <= maxDepth; col++ {
		members := colMembers[col]
		x := autoLayoutMarginX + float64(col)*autoLayoutColumnX
		for row, m := range members {
			y := autoLayoutMarginY + float64(row)*autoLayoutRowY
			switch m.kind {
			case "step":
				nodes[m.key] = XY{X: x, Y: y}
			case "well":
				wells[m.key] = XY{X: x, Y: y}
			}
		}
	}

	return CanvasLayout{
		FlowName:          flow.Name,
		Zoom:              autoLayoutZoom,
		Offset:            XY{X: 0, Y: 0},
		NodePositions:     nodes,
		DataWellPositions: wells,
	}
}

/* ----------------------------- helpers ----------------------------- */

// textBlock is the "text" content shape — used for both user and
// assistant messages. The Anthropic API also accepts a plain string
// for `Content`, but using a block list uniformly keeps the multi-turn
// repair path simpler: every message is a list of typed blocks.
type textBlock struct {
	Type string `json:"type"` // always "text"
	Text string `json:"text"`
}

// toolUseEchoBlock re-emits the model's own previous tool_use call.
// Required when extending a conversation with a tool_result: the API
// rejects a tool_result whose tool_use_id doesn't match an immediately
// preceding tool_use block in the history.
type toolUseEchoBlock struct {
	Type  string          `json:"type"` // always "tool_use"
	ID    string          `json:"id"`
	Name  string          `json:"name"`
	Input json.RawMessage `json:"input"`
}

// toolResultBlock carries our validation feedback back to the model.
// `IsError=true` is critical — without it the model treats the result
// as confirmation and won't actually retry.
type toolResultBlock struct {
	Type      string `json:"type"` // always "tool_result"
	ToolUseID string `json:"tool_use_id"`
	Content   string `json:"content"`
	IsError   bool   `json:"is_error"`
}

// userMessage builds a one-block "user" message containing plain text.
func userMessage(text string) Message {
	return Message{
		Role:    "user",
		Content: []any{textBlock{Type: "text", Text: text}},
	}
}

// assistantToolUseEcho rebuilds the assistant message that issued the
// previous tool_use call. Required by the API for the repair turn:
// the model must see its previous tool call before being asked to
// retry it via tool_result.
func assistantToolUseEcho(use *ResponseBlock) Message {
	return Message{
		Role: "assistant",
		Content: []any{toolUseEchoBlock{
			Type:  "tool_use",
			ID:    use.ID,
			Name:  use.Name,
			Input: use.Input,
		}},
	}
}

// userToolResult builds a "user"-role tool_result message. `is_error`
// is set so the model knows its previous tool call was rejected; the
// `content` field carries the human-readable error list.
func userToolResult(toolUseID, content string) Message {
	return Message{
		Role: "user",
		Content: []any{toolResultBlock{
			Type:      "tool_result",
			ToolUseID: toolUseID,
			Content:   content,
			IsError:   true,
		}},
	}
}

func truncateString(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "..."
}
