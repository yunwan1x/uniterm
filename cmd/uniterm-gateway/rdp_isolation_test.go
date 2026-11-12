package main

import (
	"net/http/httptest"
	"testing"
)

func TestRDPWorkerIsolationHeaders(t *testing.T) {
	gw := &MultiUserGateway{}
	w := httptest.NewRecorder()
	gw.ServeHTTP(w, httptest.NewRequest("GET", "/health", nil))
	if w.Header().Get("Cross-Origin-Opener-Policy") != "same-origin" || w.Header().Get("Cross-Origin-Embedder-Policy") != "credentialless" {
		t.Fatal("RDP WebCodecs shared memory requires isolation headers")
	}
}
