package main

import (
	"crypto/tls"
	"crypto/x509"
	"encoding/pem"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

func TestGatewayTLSConfiguration(t *testing.T) {
	srv := &http.Server{}
	if err := configureGatewayTLS(srv, "", ""); err != nil || srv.TLSConfig != nil {
		t.Fatal("HTTP compatibility", err)
	}
	if err := configureGatewayTLS(srv, "missing", ""); err == nil {
		t.Fatal("missing key accepted")
	}
	if err := configureGatewayTLS(srv, "missing", "missing"); err == nil {
		t.Fatal("invalid certificate accepted")
	}
	fixture := httptest.NewTLSServer(http.NotFoundHandler())
	defer fixture.Close()
	pair := fixture.TLS.Certificates[0]
	key, err := x509.MarshalPKCS8PrivateKey(pair.PrivateKey)
	if err != nil {
		t.Fatal(err)
	}
	dir := t.TempDir()
	certPath, keyPath := filepath.Join(dir, "cert.pem"), filepath.Join(dir, "key.pem")
	if err := os.WriteFile(certPath, pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: pair.Certificate[0]}), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(keyPath, pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: key}), 0600); err != nil {
		t.Fatal(err)
	}
	if err := configureGatewayTLS(srv, certPath, keyPath); err != nil {
		t.Fatal(err)
	}
	if srv.TLSConfig.MinVersion != tls.VersionTLS12 || len(srv.TLSConfig.Certificates) != 1 {
		t.Fatal("TLS policy missing")
	}
}
