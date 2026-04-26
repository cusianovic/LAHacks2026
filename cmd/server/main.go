package main

import (
	"embed"
	"flag"
	"io/fs"
	"log"
	"net/http"
	"os"

	"pupload-lahacks/internal/api"
	"pupload-lahacks/internal/build"
	"pupload-lahacks/internal/config"
	"pupload-lahacks/internal/db"
	"pupload-lahacks/internal/service"

	"github.com/joho/godotenv"
)

//go:embed all:frontend/dist
var frontendFS embed.FS

func main() {
	flags := flag.NewFlagSet("pupload-lahacks", flag.ExitOnError)
	port := flags.String("port", "", "server port (overrides PORT env var)")
	dbPath := flags.String("db", "", "database path (overrides DB_PATH env var)")
	dataDir := flags.String("data", "", "BFF data directory (overrides BFF_DATA_DIR env var, default ./data)")
	controller := flags.String("controller", "", "Pupload controller URL (overrides PUPLOAD_CONTROLLER_URL, default http://localhost:1234)")
	version := flags.Bool("version", false, "print version and exit")
	_ = flags.Parse(os.Args[1:])

	if *version {
		log.Printf("pupload-lahacks %s", build.Version)
		return
	}

	// Load .env if present so secrets like ANTHROPIC_API_KEY can live
	// in a gitignored file at the repo root rather than in the user's
	// shell rc. `godotenv.Load()` is no-op when the file is missing,
	// so this stays out of the way in production deploys that set env
	// vars directly. Existing OS env vars take precedence — we don't
	// want a stale .env to override a deliberate `export` at the CLI.
	if err := godotenv.Load(); err != nil && !os.IsNotExist(err) {
		log.Printf("config: .env load skipped: %v", err)
	}

	cfg := config.Load()
	if *port != "" {
		cfg.Port = *port
	}
	if *dbPath != "" {
		cfg.DBPath = *dbPath
	}
	if *controller != "" {
		cfg.ControllerURL = *controller
	}

	bffDataDir := *dataDir
	if bffDataDir == "" {
		bffDataDir = os.Getenv("BFF_DATA_DIR")
	}

	database, err := db.New(cfg.DBPath)
	if err != nil {
		log.Fatalf("failed to open database: %v", err)
	}

	svc := service.NewExampleService(database)

	router := api.NewRouter(svc, bffDataDir, cfg.ControllerURL, api.AIConfig{
		APIKey:  cfg.AnthropicAPIKey,
		Model:   cfg.AnthropicModel,
		BaseURL: cfg.AnthropicBaseURL,
	})

	distFS, err := fs.Sub(frontendFS, "frontend/dist")
	if err != nil {
		log.Fatalf("failed to create frontend sub-filesystem: %v", err)
	}

	mux := http.NewServeMux()
	mux.Handle("/api/", router)
	mux.Handle("/bff/", router)
	mux.Handle("/", spaHandler(http.FS(distFS)))

	log.Printf("pupload-lahacks %s starting on :%s", build.Version, cfg.Port)
	if err := http.ListenAndServe(":"+cfg.Port, mux); err != nil {
		log.Fatalf("server error: %v", err)
	}
}

// spaHandler serves static files and falls back to index.html for unknown paths,
// enabling client-side routing in the React SPA.
func spaHandler(fsys http.FileSystem) http.Handler {
	fileServer := http.FileServer(fsys)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		f, err := fsys.Open(r.URL.Path)
		if err != nil {
			r2 := *r
			r2.URL.Path = "/"
			fileServer.ServeHTTP(w, &r2)
			return
		}
		_ = f.Close()
		fileServer.ServeHTTP(w, r)
	})
}
