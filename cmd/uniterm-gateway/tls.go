package main

import (
	"crypto/tls"
	"fmt"
	"net/http"
)

// configureGatewayTLS never falls back to plaintext when TLS was requested.
func configureGatewayTLS(srv *http.Server, certFile, keyFile string) error {
	if certFile == "" && keyFile == "" {
		return nil
	}
	if certFile == "" || keyFile == "" {
		return fmt.Errorf("both certificate and private key paths are required")
	}
	pair, err := tls.LoadX509KeyPair(certFile, keyFile)
	if err != nil {
		return fmt.Errorf("load TLS certificate: %w", err)
	}
	srv.TLSConfig = &tls.Config{MinVersion: tls.VersionTLS12, Certificates: []tls.Certificate{pair}}
	return nil
}
