package session

import (
	"encoding/base64"
	mosh "github.com/unixshells/mosh-go"
	"net"
	"strings"
	"testing"
	"time"
)

func TestMoshPeerUsesSSHAddressAndAuthenticatedUDP(t *testing.T) {
	for _, network := range []string{"udp4", "udp6"} {
		t.Run(network, func(t *testing.T) {
			ip := net.ParseIP("127.0.0.1")
			if network == "udp6" {
				ip = net.ParseIP("::1")
			}
			server, err := net.ListenUDP(network, &net.UDPAddr{IP: ip})
			if err != nil {
				t.Skip(err)
			}
			defer server.Close()
			raw := []byte("0123456789abcdef")
			key := base64.RawStdEncoding.EncodeToString(raw)
			port := server.LocalAddr().(*net.UDPAddr).Port
			client, addr, err := dialMoshPeer(&net.TCPAddr{IP: ip, Port: 28246}, port, key)
			if err != nil {
				t.Fatal(err)
			}
			defer client.Close()
			if !addr.IP.Equal(ip) || addr.Port != port {
				t.Fatalf("wrong UDP peer: %v", addr)
			}
			done := make(chan struct{})
			defer func() { server.Close(); <-done }()
			go func() {
				defer close(done)
				cipher, _ := mosh.NewOCB(raw)
				transport := mosh.NewTransport(cipher, true)
				buf := make([]byte, 65536)
				for {
					n, peer, e := server.ReadFromUDP(buf)
					if e != nil {
						return
					}
					transport.Recv(buf[:n])
					transport.ForceNextSend()
					for _, packet := range transport.Tick() {
						server.WriteToUDP(packet, peer)
					}
				}
			}()
			client.Transport().SetPending(mosh.MarshalUserMessage([]mosh.UserInstruction{{Width: 80, Height: 24}}))
			if err := waitMoshReady(client, make(chan struct{}), 2*time.Second); err != nil {
				t.Fatal(err)
			}
		})
	}
}
func TestMoshNoUDPResponseTimesOutOrCancels(t *testing.T) {
	server, err := net.ListenUDP("udp4", &net.UDPAddr{IP: net.ParseIP("127.0.0.1")})
	if err != nil {
		t.Fatal(err)
	}
	defer server.Close()
	client, _, err := dialMoshPeer(&net.TCPAddr{IP: net.ParseIP("127.0.0.1")}, server.LocalAddr().(*net.UDPAddr).Port, base64.StdEncoding.EncodeToString([]byte("0123456789abcdef")))
	if err != nil {
		t.Fatal(err)
	}
	defer client.Close()
	if err := waitMoshReady(client, make(chan struct{}), 30*time.Millisecond); err == nil || !strings.Contains(err.Error(), "no authenticated") {
		t.Fatalf("want timeout, got %v", err)
	}
	quit := make(chan struct{})
	close(quit)
	if err := waitMoshReady(client, quit, time.Second); err == nil || !strings.Contains(err.Error(), "cancelled") {
		t.Fatalf("want cancellation, got %v", err)
	}
}
func TestMoshRejectsInvalidPeerPortAndKeyWithoutLeakingKey(t *testing.T) {
	for _, tc := range []struct {
		peer net.Addr
		port int
		key  string
	}{
		{nil, 60000, "secret"}, {&net.TCPAddr{IP: net.IPv4zero}, 60000, "secret"}, {&net.TCPAddr{IP: net.ParseIP("127.0.0.1")}, 0, "secret"}, {&net.TCPAddr{IP: net.ParseIP("127.0.0.1")}, 65536, "secret"}, {&net.TCPAddr{IP: net.ParseIP("127.0.0.1")}, 60000, "secret"},
	} {
		c, _, err := dialMoshPeer(tc.peer, tc.port, tc.key)
		if c != nil {
			c.Close()
		}
		if err == nil {
			t.Fatal("expected error")
		}
		if strings.Contains(err.Error(), tc.key) {
			t.Fatal("session key leaked")
		}
	}
}
