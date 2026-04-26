package api

import (
	"log"
	"net/http"

	"pupload-lahacks/internal/api/bff"
	"pupload-lahacks/internal/api/handlers"
	"pupload-lahacks/internal/service"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
)

// AIConfig bundles the Anthropic-related env so the wiring layer
// doesn't have to spread three loose strings through every constructor.
// Empty `APIKey` disables AI generation; the BFF then falls back to a
// sample flow so the editor still demos.
type AIConfig struct {
	APIKey  string
	Model   string
	BaseURL string
}

// NewRouter builds and returns the application router.
//
// Layout:
//
//	/api/*  — existing template + future controller-proxy endpoints
//	/bff/*  — Pupload editor BFF (see internal/api/bff)
//
// The BFF persists drafts/layouts under `dataDir`. Pass an empty
// string to use the default `./data`. `controllerURL` points at the
// Pupload controller engine (see `04-controller-api-reference.md`);
// pass an empty string to disable controller-backed routes (the
// editor still works, but Run/Publish will return 502). `ai` carries
// the Anthropic credentials; an empty `APIKey` means "no real AI".
func NewRouter(svc *service.ExampleService, dataDir, controllerURL string, ai AIConfig) http.Handler {
	r := chi.NewRouter()

	r.Use(middleware.RequestID)
	r.Use(corsMiddleware)
	r.Use(loggingMiddleware)
	r.Use(recoveryMiddleware)
	r.Use(rateLimiter(100, 200))

	r.Route("/api", func(r chi.Router) {
		r.Get("/health", handlers.Health)

		example := handlers.NewExample(svc)
		r.Get("/users", example.ListUsers)
		r.Post("/users", example.CreateUser)
		r.Delete("/users/{id}", example.DeleteUser)
	})

	// Mount the BFF. Failures are logged but do not stop server boot —
	// the rest of the API still works without it.
	if dataDir == "" {
		dataDir = "./data"
	}
	store, err := bff.NewFileStore(dataDir)
	if err != nil {
		log.Printf("bff: file store unavailable, /bff routes disabled: %v", err)
	} else {
		var ctrl *bff.Controller
		if controllerURL != "" {
			ctrl = bff.NewController(controllerURL)
			log.Printf("bff: controller proxy enabled → %s", controllerURL)
		} else {
			log.Printf("bff: controller URL empty, run/publish endpoints will 502")
		}
		anthropic := bff.NewAnthropicClient(ai.APIKey, ai.Model, ai.BaseURL)
		if anthropic != nil {
			log.Printf("bff: AI generation enabled (model=%s)", anthropic.Model())
		} else {
			log.Printf("bff: ANTHROPIC_API_KEY not set, AI generation falls back to sample flow")
		}
		bff.NewHandler(store, ctrl, anthropic).Mount(r)
	}

	return r
}
