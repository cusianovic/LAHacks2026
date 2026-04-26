package bff

import (
	"encoding/json"
	"fmt"
	"log"
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
	s := &FileStore{root: root}
	// One-shot migration of the legacy "demo" draft to the new UUID v7
	// project ID. Older builds used a hardcoded "demo" project ID, but
	// the controller rejects that on push (it expects a uuid.UUID). The
	// migration preserves whatever flows the user had built so they
	// don't lose work the first time they pull this fix.
	if err := s.migrateLegacyDemoDraft(); err != nil {
		log.Printf("bff: demo migration skipped: %v", err)
	}
	return s, nil
}

// migrateLegacyDemoDraft moves an old `demo.json` draft to the new
// UUID-keyed filename, rewriting the inner `Project.ID` in the
// process. It runs every server boot but is a no-op once the move has
// happened, so it's safe to leave wired up indefinitely.
//
// Behaviour:
//   - old file missing → no-op.
//   - new UUID file already present → leaves both alone (the user
//     might have re-seeded the legacy file intentionally; we never
//     clobber a non-stale UUID-keyed draft).
//   - migration errors → returned to caller, who logs and continues
//     (the BFF still works, just with a fresh seed under the UUID).
func (s *FileStore) migrateLegacyDemoDraft() error {
	const legacyID = "demo"
	oldPath := s.draftPath(legacyID)
	newPath := s.draftPath(DemoProjectID)
	if _, err := os.Stat(oldPath); os.IsNotExist(err) {
		return nil
	} else if err != nil {
		return fmt.Errorf("stat legacy draft: %w", err)
	}
	if _, err := os.Stat(newPath); err == nil {
		// New draft already exists — don't overwrite it.
		return nil
	}
	data, err := os.ReadFile(oldPath)
	if err != nil {
		return fmt.Errorf("read legacy draft: %w", err)
	}
	var ep EnrichedProject
	if err := json.Unmarshal(data, &ep); err != nil {
		return fmt.Errorf("parse legacy draft: %w", err)
	}
	ep.Project.ID = DemoProjectID
	migrated, err := json.MarshalIndent(&ep, "", "  ")
	if err != nil {
		return fmt.Errorf("marshal migrated draft: %w", err)
	}
	if err := os.WriteFile(newPath, migrated, 0o644); err != nil {
		return fmt.Errorf("write migrated draft: %w", err)
	}
	if err := os.Remove(oldPath); err != nil {
		// Non-fatal — the new file is in place; the old one is now stale.
		log.Printf("bff: removed legacy demo.json failed: %v", err)
	}
	log.Printf("bff: migrated legacy demo draft → %s", DemoProjectID)
	return nil
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
