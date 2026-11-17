//go:build server

package main

import (
	"strings"
	"testing"

	"github.com/ys-ll/uniterm/backend/packetcap"
)

func TestServerRejectsLocalPacketCaptureRPC(t *testing.T) {
	// An uninitialised manager makes accidental dispatch into the host capture
	// implementation fail, without opening any real capture interface.
	app := &App{}
	if interfaces := app.ListCaptureInterfaces(); len(interfaces) != 0 {
		t.Fatalf("server exposed local capture interfaces: %v", interfaces)
	}
	if id, err := app.StartCapture(packetcap.CaptureConfig{}); id != "" || err == nil || !strings.Contains(err.Error(), "server mode") {
		t.Fatalf("server accepted local capture: id=%q err=%v", id, err)
	}
	app.StopCapture("any-id")
}
