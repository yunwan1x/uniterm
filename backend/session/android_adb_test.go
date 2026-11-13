package session

import (
	"bytes"
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/pem"
	"os"
	"path/filepath"
	"testing"
)

func TestAndroidIdentityPersistenceAndIsolation(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("USERPROFILE", home)
	first, e := androidPrivateKey()
	if e != nil {
		t.Fatal(e)
	}
	second, e := androidPrivateKey()
	if e != nil {
		t.Fatal(e)
	}
	if !first.Equal(second) {
		t.Fatal("identity changed across reconnect")
	}
	info, e := os.Stat(filepath.Join(home, ".android", "adbkey"))
	if e != nil {
		t.Fatal(e)
	}
	if info.Mode().Perm() != 0600 {
		t.Fatalf("key permissions %o", info.Mode().Perm())
	}
	other := t.TempDir()
	t.Setenv("HOME", other)
	t.Setenv("USERPROFILE", other)
	third, e := androidPrivateKey()
	if e != nil {
		t.Fatal(e)
	}
	if first.Equal(third) {
		t.Fatal("workers share key")
	}
}
func TestAndroidExistingPKCS8IdentityAndCorruption(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("USERPROFILE", home)
	key, e := rsa.GenerateKey(rand.Reader, 2048)
	if e != nil {
		t.Fatal(e)
	}
	b, e := x509.MarshalPKCS8PrivateKey(key)
	if e != nil {
		t.Fatal(e)
	}
	os.MkdirAll(filepath.Join(home, ".android"), 0700)
	path := filepath.Join(home, ".android", "adbkey")
	if e = os.WriteFile(path, pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: b}), 0600); e != nil {
		t.Fatal(e)
	}
	loaded, e := androidPrivateKey()
	if e != nil || !key.Equal(loaded) {
		t.Fatal("legacy identity not retained", e)
	}
	corrupt := []byte("broken key")
	os.WriteFile(path, corrupt, 0600)
	if _, e = androidPrivateKey(); e == nil {
		t.Fatal("corrupt key silently replaced")
	}
	got, _ := os.ReadFile(path)
	if !bytes.Equal(got, corrupt) {
		t.Fatal("overwrote existing identity")
	}
}
func TestAndroidQuote(t *testing.T) {
	if got := androidQuote("/sdcard/a'b $(touch x)"); got != "'/sdcard/a'\\''b $(touch x)'" {
		t.Fatal(got)
	}
}
