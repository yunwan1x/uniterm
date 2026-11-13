package credentials

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestInitServerRestartWithoutPassword(t *testing.T) {
	dir := t.TempDir()
	original := New(dir, newFakeKeychain())
	original.SetSecretFiles([]string{"connections.json"})
	if err := original.InitServer("login-password"); err != nil {
		t.Fatal(err)
	}
	encrypted, err := original.Encrypt("saved-connection-password")
	if err != nil {
		t.Fatal(err)
	}
	data, _ := json.Marshal(map[string]string{"password": encrypted})
	path := filepath.Join(dir, "connections.json")
	if err := os.WriteFile(path, data, 0600); err != nil {
		t.Fatal(err)
	}
	meta, err := os.ReadFile(MetaPath(dir))
	if err != nil {
		t.Fatal(err)
	}
	for _, password := range []string{"", "wrong-password", "login-password"} {
		t.Run("restart/"+password, func(t *testing.T) {
			restarted := New(dir, newFakeKeychain())
			restarted.SetSecretFiles([]string{"connections.json"})
			err := restarted.InitServer(password)
			if (password == "wrong-password") != (err != nil) {
				t.Fatalf("init: %v", err)
			}
			status := restarted.Status()
			if status.Mode != ModeMasterPassword || status.NeedsSetup || status.ExistingSecrets != 1 {
				t.Fatalf("bad status: %+v", status)
			}
			if status.Unlocked != (password == "login-password") {
				t.Fatalf("bad unlock state: %+v", status)
			}
			if !status.Unlocked {
				if err := restarted.Unlock("wrong-password"); err == nil {
					t.Fatal("wrong password accepted")
				}
				if err := restarted.Unlock("login-password"); err != nil {
					t.Fatal(err)
				}
			}
			plain, err := restarted.Decrypt(encrypted)
			if err != nil || plain != "saved-connection-password" {
				t.Fatalf("decrypt: %q %v", plain, err)
			}
			after, _ := os.ReadFile(MetaPath(dir))
			if !bytes.Equal(after, meta) {
				t.Fatal("metadata changed")
			}
			after, _ = os.ReadFile(path)
			if !bytes.Equal(after, data) {
				t.Fatal("ciphertext changed")
			}
		})
	}
}

func TestInitServerPreservesUnreadableMetadata(t *testing.T) {
	dir := t.TempDir()
	path := MetaPath(dir)
	before := []byte("{broken metadata")
	if err := os.WriteFile(path, before, 0600); err != nil {
		t.Fatal(err)
	}
	s := New(dir, newFakeKeychain())
	if err := s.InitServer("login-password"); err == nil {
		t.Fatal("expected metadata error")
	}
	after, _ := os.ReadFile(path)
	if !bytes.Equal(before, after) || s.Unlocked() {
		t.Fatal("damaged store was modified or unlocked")
	}
}

func TestInitServerLegacyAndMissingMetadata(t *testing.T) {
	t.Run("legacy", func(t *testing.T) {
		dir := t.TempDir()
		original := New(dir, newFakeKeychain())
		if err := original.Setup(ModeKeychain, ""); err != nil {
			t.Fatal(err)
		}
		restarted := New(dir, newFakeKeychain())
		if err := restarted.InitServer("login-password"); err != nil {
			t.Fatal(err)
		}
		status := restarted.Status()
		if status.Mode != ModeKeychain || !status.KeychainLost || status.NeedsSetup || status.Unlocked {
			t.Fatalf("bad status: %+v", status)
		}
	})
	t.Run("missing-meta-existing-secrets", func(t *testing.T) {
		dir := t.TempDir()
		s := New(dir, newFakeKeychain())
		s.SetSecretFiles([]string{"connections.json"})
		if err := os.WriteFile(filepath.Join(dir, "connections.json"), []byte(`{"password":"enc:v1:existing"}`), 0600); err != nil {
			t.Fatal(err)
		}
		if err := s.InitServer("login-password"); err == nil {
			t.Fatal("must not replace key for existing ciphertext")
		}
		if _, err := os.Stat(MetaPath(dir)); !os.IsNotExist(err) {
			t.Fatal("created replacement metadata")
		}
	})
}
