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

// NewRouter builds and returns the application router.
//
// Layout:
//
//	/api/*  — existing template + future controller-proxy endpoints
//	/bff/*  — Pupload editor BFF (see internal/api/bff)
//
// The BFF persists drafts/layouts under `dataDir`. Pass an empty
// string to use the default `./data`.
func NewRouter(svc *service.ExampleService, dataDir string) http.Handler {
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
		bff.NewHandler(store).Mount(r)
	}

	return r
}
