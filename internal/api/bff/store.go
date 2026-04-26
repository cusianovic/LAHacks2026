package bff

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sync"
)

// FileStore persists EnrichedProject drafts to disk as JSON.
//
// One file per project: <root>/drafts/<projectID>.json
//
// This is intentionally simple. Swap for SQLite, Redis, or a real
// controller call in `LoadProject` / `SaveProject` when the engine
// is ready. The handler API does not change.
type FileStore struct {
	root string
	mu   sync.Mutex
}

func NewFileStore(root string) (*FileStore, error) {
	if err := os.MkdirAll(filepath.Join(root, "drafts"), 0o755); err != nil {
		return nil, fmt.Errorf("bff: create drafts dir: %w", err)
	}
	return &FileStore{root: root}, nil
}

func (s *FileStore) draftPath(projectID string) string {
	safe := safeFilename(projectID)
	return filepath.Join(s.root, "drafts", safe+".json")
}

func (s *FileStore) LoadProject(projectID string) (*EnrichedProject, bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	data, err := os.ReadFile(s.draftPath(projectID))
	if os.IsNotExist(err) {
		return nil, false, nil
	}
	if err != nil {
		return nil, false, fmt.Errorf("bff: read draft: %w", err)
	}
	var ep EnrichedProject
	if err := json.Unmarshal(data, &ep); err != nil {
		return nil, false, fmt.Errorf("bff: parse draft: %w", err)
	}
	return &ep, true, nil
}

func (s *FileStore) SaveProject(projectID string, ep *EnrichedProject) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	data, err := json.MarshalIndent(ep, "", "  ")
	if err != nil {
		return fmt.Errorf("bff: marshal draft: %w", err)
	}
	tmp := s.draftPath(projectID) + ".tmp"
	if err := os.WriteFile(tmp, data, 0o644); err != nil {
		return fmt.Errorf("bff: write draft: %w", err)
	}
	if err := os.Rename(tmp, s.draftPath(projectID)); err != nil {
		return fmt.Errorf("bff: rename draft: %w", err)
	}
	return nil
}

// safeFilename strips characters that would escape the drafts directory.
// Project IDs are user-supplied; never trust them as raw paths.
func safeFilename(id string) string {
	out := make([]rune, 0, len(id))
	for _, r := range id {
		switch {
		case r >= 'a' && r <= 'z',
			r >= 'A' && r <= 'Z',
			r >= '0' && r <= '9',
			r == '-', r == '_':
			out = append(out, r)
		default:
			out = append(out, '_')
		}
	}
	if len(out) == 0 {
		return "default"
	}
	return string(out)
}
