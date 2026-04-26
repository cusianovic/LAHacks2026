package config

import (
	"os"
)

// Config holds all application configuration.
type Config struct {
	Port          string
	DBPath        string
	CORSOrigin    string
	Env           string
	ControllerURL string

	// Anthropic / Claude integration. Used by the BFF's AI generation
	// endpoint. Empty key disables the integration; the BFF then falls
	// back to a hardcoded sample flow so the editor still demos
	// without requiring an API key.
	AnthropicAPIKey  string
	AnthropicModel   string
	AnthropicBaseURL string
}

// Load reads configuration from environment variables with sensible defaults.
func Load() *Config {
	return &Config{
		Port:          getEnv("PORT", "8080"),
		DBPath:        getEnv("DB_PATH", "./pupload-lahacks.db"),
		CORSOrigin:    getEnv("CORS_ORIGIN", "*"),
		Env:           getEnv("APP_ENV", "production"),
		ControllerURL: getEnv("PUPLOAD_CONTROLLER_URL", "http://localhost:1234"),

		// `claude-sonnet-4-5` is the latest Sonnet at time of writing —
		// fast, cheap, and reliable with tool-use. Override with
		// `ANTHROPIC_MODEL` if a newer model ships before this is
		// updated. Override the base URL via `ANTHROPIC_BASE_URL` for
		// proxy/Bedrock setups; the default targets the public API.
		AnthropicAPIKey:  getEnv("ANTHROPIC_API_KEY", ""),
		AnthropicModel:   getEnv("ANTHROPIC_MODEL", "claude-sonnet-4-5"),
		AnthropicBaseURL: getEnv("ANTHROPIC_BASE_URL", "https://api.anthropic.com"),
	}
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
