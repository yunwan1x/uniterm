package adb

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/rsa"
	"crypto/tls"
	"encoding/binary"
	"io"
	"net"
	"testing"
	"time"
)

func TestClosedStreamDrainsQueuedData(t *testing.T) {
	for i := 0; i < 100; i++ {
		s := newStream(nil, 1)
		s.readCh <- []byte("complete tail")
		s.handleClse()
		got, err := io.ReadAll(s)
		if err != nil || string(got) != "complete tail" {
			t.Fatalf("lost data %q %v", got, err)
		}
	}
}
func TestPairingPacketBounds(t *testing.T) {
	h := make([]byte, 6)
	h[0] = HeaderVersion
	binary.BigEndian.PutUint32(h[2:], 0xffffffff)
	if _, _, err := readPairingPacket(bytes.NewReader(h)); err == nil {
		t.Fatal("accepted unbounded packet")
	}
}
func TestPairingCancellationAfterTLS(t *testing.T) {
	SetLogger(NewDefaultLogger(io.Discard, "", 0))
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	cert, err := GenerateTLSCertificate(key, "test")
	if err != nil {
		t.Fatal(err)
	}
	ln, err := tls.Listen("tcp", "127.0.0.1:0", &tls.Config{Certificates: []tls.Certificate{cert}})
	if err != nil {
		t.Fatal(err)
	}
	defer ln.Close()
	done := make(chan struct{})
	go func() {
		defer close(done)
		c, e := ln.Accept()
		if e != nil {
			return
		}
		defer c.Close()
		c.SetDeadline(time.Now().Add(3 * time.Second))
		io.Copy(io.Discard, c)
	}()
	ctx, cancel := context.WithTimeout(context.Background(), 200*time.Millisecond)
	defer cancel()
	start := time.Now()
	err = Pair(ctx, ln.Addr().String(), "123456", key, "test")
	if err == nil || time.Since(start) > time.Second {
		t.Fatalf("pairing failed to cancel: %v", err)
	}
	<-done
}
func TestHandshakeCancellationClosesConnection(t *testing.T) {
	a, b := net.Pipe()
	defer b.Close()
	go io.Copy(io.Discard, b)
	c := NewConnection(a, nil, "test", 30)
	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()
	if err := c.Connect(ctx); err == nil {
		t.Fatal("expected timeout")
	}
	select {
	case <-c.Disconnected():
	case <-time.After(time.Second):
		t.Fatal("read loop leaked")
	}
}
