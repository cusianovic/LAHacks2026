package bff

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"math/rand"
	"net/http"
	"strconv"
	"time"
)

// =====================================================================
// Anthropic Messages API client.
//
// Scope: a focused HTTP client for `POST /v1/messages` with tool-use.
// Not a full Anthropic SDK — only the surface the BFF's AI generator
// touches. The single moving part the rest of the package consumes is
// `AnthropicClient.Messages`, which returns the parsed `MessagesResponse`
// (or a typed error). Retries are baked in.
//
// Why a hand-rolled client:
//   - No third-party SDK in `go.mod`. The Anthropic API is small and
//     keeping the dependency surface tight makes auditing easier.
//   - Tool-use payloads need careful JSON-shape control (the server
//     is picky about `null` vs missing keys); a thin client makes
//     that tractable.
//   - Retry semantics are tuned for our case: the AI generator does
//     one expensive call per request and we'd rather block for a
//     second than fail on a transient 429.
//
// Reference: https://docs.anthropic.com/en/api/messages
// =====================================================================

// AnthropicClient is a thin Messages-API client. Construct via
// `NewAnthropicClient`; pass the result to `generateAIFlow` (see
// `ai_generate.go`). Safe for concurrent use — the underlying
// http.Client handles connection reuse.
type AnthropicClient struct {
	apiKey  string
	model   string
	baseURL string
	hc      *http.Client

	// Retry knobs. Override in tests via `WithMaxAttempts`/`WithBackoff`
	// if needed — production code shouldn't need to.
	maxAttempts    int
	initialBackoff time.Duration
	maxBackoff     time.Duration
}

// NewAnthropicClient builds a client. Returns nil if `apiKey` is empty
// — callers should treat nil as "AI integration disabled" and fall back
// to the sample flow. `model` and `baseURL` come from `internal/config`;
// pass empty strings to use the documented defaults.
func NewAnthropicClient(apiKey, model, baseURL string) *AnthropicClient {
	if apiKey == "" {
		return nil
	}
	if model == "" {
		model = "claude-sonnet-4-5"
	}
	if baseURL == "" {
		baseURL = "https://api.anthropic.com"
	}
	return &AnthropicClient{
		apiKey:  apiKey,
		model:   model,
		baseURL: baseURL,
		hc: &http.Client{
			// Generous: Claude tool-use calls with long system prompts
			// can take 30+ seconds for the larger models. The handler
			// passes its own ctx so the user can still cancel client-side.
			Timeout: 90 * time.Second,
		},
		maxAttempts:    4,
		initialBackoff: 700 * time.Millisecond,
		maxBackoff:     8 * time.Second,
	}
}

// Model returns the model name the client is configured to use.
// Useful for log lines and for the AI generator's debug output.
func (c *AnthropicClient) Model() string {
	if c == nil {
		return ""
	}
	return c.model
}

/* --------------------------- request types --------------------------- */

// MessagesRequest mirrors the body shape of `POST /v1/messages`. We
// only model the fields we actually use; unknown keys round-trip via
// `json.RawMessage` where needed.
type MessagesRequest struct {
	Model     string    `json:"model"`
	MaxTokens int       `json:"max_tokens"`
	System    string    `json:"system,omitempty"`
	Messages  []Message `json:"messages"`

	// Tools and tool_choice drive structured outputs. When set with
	// `tool_choice: {"type":"tool","name":<name>}`, Claude is forced
	// to invoke the named tool — its arguments arrive as a
	// `tool_use` content block. This is far more reliable than asking
	// for "JSON in a code block" and parsing free text.
	Tools      []Tool      `json:"tools,omitempty"`
	ToolChoice *ToolChoice `json:"tool_choice,omitempty"`

	// Optional generation knobs. Defaults are server-side; the
	// generator currently leaves these unset.
	Temperature *float64 `json:"temperature,omitempty"`
	TopP        *float64 `json:"top_p,omitempty"`
}

// Message is one item in the `messages` array. Role is "user" or
// "assistant". `Content` is a heterogeneous slice of blocks — text,
// tool_use (assistant only), tool_result (user only), etc. We use
// `any` so the generator can mix block kinds in a single message
// without forcing every block through the same struct shape. Block
// builders live in `ai_generate.go` (`textBlock`, `toolUseEchoBlock`,
// `toolResultBlock`); they each return a small struct whose JSON tags
// match the Anthropic spec.
type Message struct {
	Role    string `json:"role"`
	Content []any  `json:"content"`
}

// Tool is one entry in `tools`. `InputSchema` is a JSON Schema the
// model must match when invoking the tool. Keep it tight: extra fields
// are ignored, missing required fields cause a model-side retry.
type Tool struct {
	Name        string          `json:"name"`
	Description string          `json:"description"`
	InputSchema json.RawMessage `json:"input_schema"`
}

// ToolChoice forces Claude to either auto-pick a tool, pick any tool,
// or invoke a specific one. Forcing a specific tool is how we get
// deterministic structured outputs from the generator.
type ToolChoice struct {
	Type string `json:"type"` // "auto" | "any" | "tool"
	Name string `json:"name,omitempty"`
}

/* -------------------------- response types --------------------------- */

// MessagesResponse is the body of a successful 200 from `POST /v1/messages`.
// The interesting field for the generator is `Content` — the assistant's
// reply, which for tool-forced calls contains exactly one `tool_use`
// block carrying the structured arguments.
type MessagesResponse struct {
	ID         string          `json:"id"`
	Type       string          `json:"type"`
	Role       string          `json:"role"`
	Model      string          `json:"model"`
	StopReason string          `json:"stop_reason"`
	Content    []ResponseBlock `json:"content"`
	Usage      ResponseUsage   `json:"usage"`
}

// ResponseBlock is one item in the response's content array. The
// fields are populated based on `Type`:
//   - "text"      → Text
//   - "tool_use"  → ID, Name, Input
type ResponseBlock struct {
	Type  string          `json:"type"`
	Text  string          `json:"text,omitempty"`
	ID    string          `json:"id,omitempty"`
	Name  string          `json:"name,omitempty"`
	Input json.RawMessage `json:"input,omitempty"`
}

type ResponseUsage struct {
	InputTokens  int `json:"input_tokens"`
	OutputTokens int `json:"output_tokens"`
}

// FirstToolUse returns the first tool_use block in the response, or
// nil if none is present. Convenience for the generator which forces
// exactly one tool call per request.
func (r *MessagesResponse) FirstToolUse() *ResponseBlock {
	for i := range r.Content {
		if r.Content[i].Type == "tool_use" {
			return &r.Content[i]
		}
	}
	return nil
}

// FirstText concatenates any text blocks from the response. Used for
// surfacing model warnings/notes alongside a structured tool call.
func (r *MessagesResponse) FirstText() string {
	for _, b := range r.Content {
		if b.Type == "text" && b.Text != "" {
			return b.Text
		}
	}
	return ""
}

/* ------------------------------ errors ------------------------------- */

// AnthropicError is the typed error returned by `Messages` for
// non-2xx responses that survived all retries. `StatusCode` is the
// final HTTP status; `RawBody` is the (possibly truncated) response
// body for diagnostics.
type AnthropicError struct {
	StatusCode int
	Type       string
	Message    string
	RawBody    string
}

func (e *AnthropicError) Error() string {
	if e.Type != "" {
		return fmt.Sprintf("anthropic %d %s: %s", e.StatusCode, e.Type, e.Message)
	}
	return fmt.Sprintf("anthropic %d: %s", e.StatusCode, e.Message)
}

// IsRetryable reports whether the error class warrants another attempt.
// Used by the retry loop in `Messages`; exported so callers can make
// their own decisions if they wrap multiple Messages calls.
func (e *AnthropicError) IsRetryable() bool {
	return e.StatusCode == http.StatusTooManyRequests ||
		e.StatusCode == http.StatusInternalServerError ||
		e.StatusCode == http.StatusBadGateway ||
		e.StatusCode == http.StatusServiceUnavailable ||
		e.StatusCode == http.StatusGatewayTimeout
}

/* ------------------------------ client ------------------------------- */

// Messages calls `POST /v1/messages` with the given request. The
// configured model is stamped into `req.Model` if the caller didn't
// set one (the typical case). Retries are applied for retryable
// errors (network, 429, 5xx) up to `maxAttempts`. The provided ctx
// is honoured throughout: cancellation immediately aborts the in-flight
// HTTP request and any pending backoff.
func (c *AnthropicClient) Messages(ctx context.Context, req MessagesRequest) (*MessagesResponse, error) {
	if c == nil {
		return nil, errors.New("anthropic: client not configured (missing API key)")
	}
	if req.Model == "" {
		req.Model = c.model
	}
	if req.MaxTokens == 0 {
		// Tool-use responses are usually small (the JSON arguments).
		// 4096 is plenty and keeps cost bounded.
		req.MaxTokens = 4096
	}
	body, err := json.Marshal(&req)
	if err != nil {
		return nil, fmt.Errorf("anthropic: marshal request: %w", err)
	}

	var lastErr error
	for attempt := 1; attempt <= c.maxAttempts; attempt++ {
		resp, err := c.doOnce(ctx, body)
		if err == nil {
			return resp, nil
		}

		// Decide whether to retry. Context cancellation is never retried.
		if ctxErr := ctx.Err(); ctxErr != nil {
			return nil, ctxErr
		}
		retryable := false
		var ae *AnthropicError
		if errors.As(err, &ae) {
			retryable = ae.IsRetryable()
		} else {
			// Non-API error (network/dial/timeout) — always retryable.
			retryable = true
		}
		lastErr = err
		if !retryable || attempt == c.maxAttempts {
			return nil, err
		}

		wait := c.backoff(attempt, err)
		log.Printf("anthropic: attempt %d/%d failed (%v) — retrying in %s",
			attempt, c.maxAttempts, err, wait)
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-time.After(wait):
		}
	}
	return nil, lastErr
}

// doOnce performs a single round-trip and returns either a parsed
// response or a typed error. Never retries — the caller does that.
func (c *AnthropicClient) doOnce(ctx context.Context, body []byte) (*MessagesResponse, error) {
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+"/v1/messages", bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("anthropic: build request: %w", err)
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Accept", "application/json")
	httpReq.Header.Set("x-api-key", c.apiKey)
	// Pin the API version. Anthropic uses date-stamped versions; this
	// one is the long-stable "messages" version. Bump alongside any
	// breaking-change SDK upgrade.
	httpReq.Header.Set("anthropic-version", "2023-06-01")

	httpResp, err := c.hc.Do(httpReq)
	if err != nil {
		return nil, err
	}
	defer httpResp.Body.Close()

	respBody, err := io.ReadAll(io.LimitReader(httpResp.Body, 1<<20))
	if err != nil {
		return nil, fmt.Errorf("anthropic: read response: %w", err)
	}

	if httpResp.StatusCode/100 == 2 {
		var parsed MessagesResponse
		if err := json.Unmarshal(respBody, &parsed); err != nil {
			return nil, fmt.Errorf("anthropic: parse response: %w (body=%q)", err, truncate(respBody, 200))
		}
		return &parsed, nil
	}

	// Non-2xx → typed error. Try to parse Anthropic's error envelope
	// (`{"type":"error","error":{"type":"...","message":"..."}}`)
	// for nicer logs; fall back to raw body if it doesn't fit.
	ae := &AnthropicError{
		StatusCode: httpResp.StatusCode,
		RawBody:    string(truncate(respBody, 1024)),
	}
	var envelope struct {
		Error struct {
			Type    string `json:"type"`
			Message string `json:"message"`
		} `json:"error"`
	}
	if json.Unmarshal(respBody, &envelope) == nil && envelope.Error.Message != "" {
		ae.Type = envelope.Error.Type
		ae.Message = envelope.Error.Message
	} else {
		ae.Message = http.StatusText(httpResp.StatusCode)
	}

	// 429 may include a retry-after; surface it through the error
	// so the backoff helper can honour it.
	if ra := httpResp.Header.Get("retry-after"); ra != "" {
		ae.Message += " (retry-after=" + ra + ")"
	}
	return nil, ae
}

// backoff returns the next sleep duration. For 429s with a server
// `retry-after` value we honour it; otherwise we use exponential
// backoff with jitter capped at `maxBackoff`.
func (c *AnthropicClient) backoff(attempt int, err error) time.Duration {
	var ae *AnthropicError
	if errors.As(err, &ae) && ae.StatusCode == http.StatusTooManyRequests {
		if d, ok := parseRetryAfter(ae.Message); ok && d > 0 {
			if d > c.maxBackoff {
				d = c.maxBackoff
			}
			return d
		}
	}
	d := c.initialBackoff * (1 << (attempt - 1))
	if d > c.maxBackoff {
		d = c.maxBackoff
	}
	// Jitter: ±25%. Keeps a stampede of clients from re-hitting the
	// API at exactly the same moment after a 5xx.
	jit := time.Duration(rand.Int63n(int64(d) / 2))
	return d - d/4 + jit
}

// parseRetryAfter extracts a duration from an error message of the
// form `"... (retry-after=<value>)"`. The header may be either delta
// seconds or an HTTP-date; we only handle the seconds form (the
// dominant case for Anthropic).
func parseRetryAfter(msg string) (time.Duration, bool) {
	const marker = "(retry-after="
	i := indexOf(msg, marker)
	if i < 0 {
		return 0, false
	}
	rest := msg[i+len(marker):]
	end := indexOf(rest, ")")
	if end < 0 {
		return 0, false
	}
	val := rest[:end]
	secs, err := strconv.Atoi(val)
	if err != nil || secs <= 0 {
		return 0, false
	}
	return time.Duration(secs) * time.Second, true
}

// indexOf is a tiny wrapper around strings.Index that avoids the
// `strings` import for the few places we need it. Kept private.
func indexOf(s, substr string) int {
	for i := 0; i+len(substr) <= len(s); i++ {
		if s[i:i+len(substr)] == substr {
			return i
		}
	}
	return -1
}

// truncate returns at most n bytes of b. Used for log-friendly error
// payloads — full bodies can be megabytes after a server-side error.
func truncate(b []byte, n int) []byte {
	if len(b) <= n {
		return b
	}
	out := make([]byte, n+3)
	copy(out, b[:n])
	copy(out[n:], "...")
	return out
}
