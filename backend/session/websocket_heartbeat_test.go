package session

import (
	"context"
	"encoding/json"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

func testHeartbeatOptions() sessionWebSocketHeartbeatOptions {
	return sessionWebSocketHeartbeatOptions{interval: 20 * time.Millisecond, pongTimeout: 240 * time.Millisecond, writeTimeout: 100 * time.Millisecond}
}

// Real protocol proxy fixtures, with a quiet TCP peer. RDP negotiates standard
// RDP security so the test covers its real handshake and relay without TLS.
func heartbeatProxyFixture(t *testing.T, protocol string) (*websocket.Conn, net.Conn) {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { listener.Close() })
	peer := make(chan net.Conn, 1)
	acceptErr := make(chan error, 1)
	go func() {
		conn, err := listener.Accept()
		if err != nil {
			acceptErr <- err
			return
		}
		if protocol == "rdp" {
			if _, err := readTPKTPDU(conn, time.Second); err != nil {
				conn.Close()
				acceptErr <- err
				return
			}
			response := []byte{3, 0, 0, 19, 14, 0xd0, 0, 0, 0x12, 0x34, 0, 2, 0, 8, 0, 0, 0, 0, 0}
			if _, err := conn.Write(response); err != nil {
				conn.Close()
				acceptErr <- err
				return
			}
			_ = conn.SetDeadline(time.Time{})
		}
		peer <- conn
	}()
	var addr string
	switch protocol {
	case "rdp":
		proxy := NewRDPProxy(listener.Addr().String(), nil, "proxy-lifecycle-test", RDPOptions{})
		proxy.heartbeat = testHeartbeatOptions()
		addr, err = proxy.Start()
		t.Cleanup(proxy.Stop)
	case "vnc":
		proxy := NewVNCProxy(listener.Addr().String())
		proxy.heartbeat = testHeartbeatOptions()
		addr, err = proxy.Start()
		t.Cleanup(proxy.Stop)
	case "spice":
		proxy := NewSPICEProxy(listener.Addr().String())
		proxy.heartbeat = testHeartbeatOptions()
		addr, err = proxy.Start()
		t.Cleanup(proxy.Stop)
	}
	if err != nil {
		t.Fatal(err)
	}
	ws, _, err := websocket.DefaultDialer.Dial(addr, nil)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { ws.Close() })
	if protocol == "rdp" {
		if err := ws.WriteMessage(websocket.BinaryMessage, rdpProxyRequest(listener.Addr().String())); err != nil {
			t.Fatal(err)
		}
		_ = ws.SetReadDeadline(time.Now().Add(time.Second))
		if _, _, err := ws.ReadMessage(); err != nil {
			t.Fatal(err)
		}
		_ = ws.SetReadDeadline(time.Time{})
	}
	select {
	case conn := <-peer:
		t.Cleanup(func() { conn.Close() })
		return ws, conn
	case err := <-acceptErr:
		t.Fatal(err)
	case <-time.After(2 * time.Second):
		t.Fatal("proxy did not connect to fixture")
	}
	return nil, nil
}

func TestRemoteProxyHeartbeatKeepsStaticSessionAlive(t *testing.T) {
	for _, protocol := range []string{"rdp", "vnc", "spice"} {
		t.Run(protocol, func(t *testing.T) {
			ws, peer := heartbeatProxyFixture(t, protocol)
			result := make(chan error, 1)
			go func() {
				_, data, err := ws.ReadMessage() // also handles ping and sends pong
				if err == nil && string(data) != "still alive" {
					err = io.ErrUnexpectedEOF
				}
				result <- err
			}()
			select {
			case err := <-result:
				t.Fatalf("static session closed early: %v", err)
			case <-time.After(2 * testHeartbeatOptions().pongTimeout):
			}
			if _, err := peer.Write([]byte("still alive")); err != nil {
				t.Fatal(err)
			}
			select {
			case err := <-result:
				if err != nil {
					t.Fatal(err)
				}
			case <-time.After(time.Second):
				t.Fatal("session stopped relaying after static period")
			}
		})
	}
}

func TestRemoteProxyHeartbeatClosesMissingPong(t *testing.T) {
	for _, protocol := range []string{"rdp", "vnc", "spice"} {
		t.Run(protocol, func(t *testing.T) {
			ws, peer := heartbeatProxyFixture(t, protocol)
			ws.SetPingHandler(func(string) error { return nil })
			result := make(chan error, 1)
			go func() { _, _, err := ws.ReadMessage(); result <- err }()
			select {
			case err := <-result:
				if err == nil {
					t.Fatal("unresponsive client received data instead of closing")
				}
			case <-time.After(2 * time.Second):
				t.Fatal("missing pong left websocket alive")
			}
			_ = peer.SetReadDeadline(time.Now().Add(time.Second))
			var buf [1]byte
			if _, err := peer.Read(buf[:]); err != io.EOF {
				t.Fatalf("upstream was not closed: %v", err)
			}
		})
	}
}

func TestSessionWebSocketHeartbeatStopsWithoutClosingSession(t *testing.T) {
	released := make(chan struct{})
	keepServer := make(chan struct{})
	var closed atomic.Bool
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ws, err := (&websocket.Upgrader{}).Upgrade(w, r, nil)
		if err != nil {
			return
		}
		defer ws.Close()
		stop := startSessionWebSocketHeartbeat(ws, testHeartbeatOptions(), func() { closed.Store(true) })
		stop()
		stop()
		close(released)
		<-keepServer
	}))
	defer server.Close()
	defer close(keepServer)
	ws, _, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(server.URL, "http"), nil)
	if err != nil {
		t.Fatal(err)
	}
	defer ws.Close()
	<-released
	time.Sleep(2 * testHeartbeatOptions().pongTimeout)
	if closed.Load() {
		t.Fatal("stopped heartbeat closed transport later")
	}
}

func TestAndroidFailedUpgradeReleasesViewerSlot(t *testing.T) {
	session := NewAndroidSession("upgrade-retry")
	session.token = "upgrade-test-token"
	request := httptest.NewRequest(http.MethodGet, "/"+session.token, nil)
	recorder := httptest.NewRecorder()
	session.handle(recorder, request)
	if recorder.Code == http.StatusConflict {
		t.Fatal("first request was rejected as duplicate")
	}
	session.mu.Lock()
	serving := session.serving
	session.mu.Unlock()
	if serving {
		t.Fatal("failed websocket upgrade reserved the Android viewer forever")
	}
	recorder = httptest.NewRecorder()
	session.handle(recorder, request)
	if recorder.Code == http.StatusConflict {
		t.Fatal("failed upgrade prevented another attempt")
	}
}

func TestVNCProxyOwnsSocketUntilDisconnect(t *testing.T) {
	proxy := NewVNCProxy(spiceProxyEchoServer(t))
	addr, err := proxy.Start()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(proxy.Stop)
	ws, _, err := websocket.DefaultDialer.Dial(addr, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer ws.Close()
	_ = ws.SetReadDeadline(time.Now().Add(time.Second))
	if _, _, err := ws.ReadMessage(); err != nil {
		t.Fatal(err)
	} // TCP greeting
	duplicate, _, err := websocket.DefaultDialer.Dial(addr, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer duplicate.Close()
	_ = duplicate.SetReadDeadline(time.Now().Add(time.Second))
	if _, _, err := duplicate.ReadMessage(); err == nil {
		t.Fatal("duplicate VNC viewer was accepted")
	} else if e, ok := err.(net.Error); ok && e.Timeout() {
		t.Fatal("duplicate VNC viewer was left open")
	}
	if err := ws.WriteMessage(websocket.BinaryMessage, []byte("original")); err != nil {
		t.Fatal(err)
	}
	if _, data, err := ws.ReadMessage(); err != nil || string(data) != "original" {
		t.Fatalf("original viewer interrupted: %q, %v", data, err)
	}
}

func TestVNCProxyStopDuringUpgrade(t *testing.T) {
	for range 10 {
		proxy := NewVNCProxy("127.0.0.1:1")
		addr, err := proxy.Start()
		if err != nil {
			t.Fatal(err)
		}
		var attempts sync.WaitGroup
		for range 5 {
			attempts.Go(func() {
				if ws, _, err := websocket.DefaultDialer.Dial(addr, nil); err == nil {
					ws.Close()
				}
			})
		}
		done := make(chan struct{})
		go func() { proxy.Stop(); attempts.Wait(); close(done) }()
		select {
		case <-done:
		case <-time.After(2 * time.Second):
			t.Fatal("VNC shutdown left an upgrading connection alive")
		}
		proxy.mu.Lock()
		retained := proxy.wsConn != nil || proxy.tcpConn != nil
		proxy.mu.Unlock()
		if retained {
			t.Fatal("VNC shutdown retained a transport")
		}
		if _, err := proxy.Start(); err == nil {
			t.Fatal("stopped VNC proxy restarted")
		}
	}
}

// Cancellation is independent of protocol read progress: Android can be
// blocked writing a device-control packet when a browser disappears.
func TestSessionWebSocketHeartbeatCancelsBlockedTransport(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ws, err := (&websocket.Upgrader{}).Upgrade(w, r, nil)
		if err != nil {
			return
		}
		defer ws.Close()
		stop := startSessionWebSocketHeartbeat(ws, testHeartbeatOptions(), cancel)
		defer stop()
		<-ctx.Done() // models a relay which cannot return to ReadMessage
	}))
	defer server.Close()
	ws, _, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(server.URL, "http"), nil)
	if err != nil {
		t.Fatal(err)
	}
	defer ws.Close()
	select {
	case <-ctx.Done():
	case <-time.After(2 * time.Second):
		t.Fatal("watchdog required a progressing read loop")
	}
}

func TestAndroidUpgradeAfterDisconnectClosesSocket(t *testing.T) {
	session := NewAndroidSession("closed-upgrade")
	session.token = "closed-upgrade-token"
	session.ctx, session.cancel = context.WithCancel(context.Background())
	session.cancel()
	server := httptest.NewServer(http.HandlerFunc(session.handle))
	defer server.Close()
	ws, _, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(server.URL, "http")+"/"+session.token, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer ws.Close()
	_ = ws.SetReadDeadline(time.Now().Add(time.Second))
	if _, _, err := ws.ReadMessage(); err == nil {
		t.Fatal("disconnected Android session accepted viewer")
	} else if e, ok := err.(net.Error); ok && e.Timeout() {
		t.Fatal("late Android upgrade leaked its socket")
	}
	session.mu.Lock()
	retained := session.ws != nil
	session.mu.Unlock()
	if retained {
		t.Fatal("disconnected Android session retained upgraded socket")
	}
}

func TestAndroidRedroidHeartbeat(t *testing.T) {
	if os.Getenv("UNITERM_ANDROID_LIVE") == "" {
		t.Skip("explicit local redroid fixture required")
	}
	t.Setenv("HOME", t.TempDir())
	for _, respond := range []bool{true, false} {
		name := "missing-pong"
		if respond {
			name = "static-session"
		}
		t.Run(name, func(t *testing.T) {
			session := NewAndroidSession("heartbeat-" + name)
			session.heartbeat = sessionWebSocketHeartbeatOptions{interval: 120 * time.Millisecond, pongTimeout: 900 * time.Millisecond, writeTimeout: time.Second}
			if err := session.Connect(ConnectionConfig{Host: "127.0.0.1", Port: 15555}); err != nil {
				t.Fatal(err)
			}
			defer session.Disconnect()
			ws, _, err := websocket.DefaultDialer.Dial(session.ProxyAddr(), nil)
			if err != nil {
				t.Fatal(err)
			}
			defer ws.Close()
			_ = ws.SetReadDeadline(time.Now().Add(20 * time.Second))
			originalPingHandler := ws.PingHandler()
			var pings atomic.Int32
			var frames atomic.Int32
			ws.SetPingHandler(func(data string) error {
				pings.Add(1)
				if respond {
					return originalPingHandler(data)
				}
				return nil
			})
			ready := make(chan struct{})
			done := make(chan error, 1)
			go func() {
				var once sync.Once
				for {
					kind, data, err := ws.ReadMessage()
					if err != nil {
						done <- err
						return
					}
					if kind == websocket.TextMessage {
						var meta map[string]any
						if json.Unmarshal(data, &meta) == nil && meta["width"] != nil {
							once.Do(func() { close(ready) })
						}
					} else if len(data) > 13 && data[0] == 1 {
						frames.Add(1)
					}
				}
			}()
			select {
			case <-ready:
			case err := <-done:
				t.Fatalf("Android startup failed: %v", err)
			case <-time.After(20 * time.Second):
				t.Fatal("Android metadata never arrived")
			}
			if respond {
				select {
				case err := <-done:
					t.Fatalf("responsive Android viewer closed: %v", err)
				case <-time.After(2 * session.heartbeat.pongTimeout):
				}
				if pings.Load() < 3 || frames.Load() == 0 || session.ctx.Err() != nil {
					t.Fatalf("Android heartbeat/media failed: pings=%d video=%d context=%v", pings.Load(), frames.Load(), session.ctx.Err())
				}
				ws.Close()
				select {
				case <-done:
				case <-time.After(2 * time.Second):
					t.Fatal("Android reader remained after close")
				}
				t.Logf("Android stayed connected with %d protocol pings and %d video packets", pings.Load(), frames.Load())
			} else {
				select {
				case <-done:
				case <-time.After(3 * time.Second):
					t.Fatal("Android viewer without pong was retained")
				}
				select {
				case <-session.ctx.Done():
				case <-time.After(time.Second):
					t.Fatal("Android heartbeat did not cancel its ADB streams")
				}
				t.Logf("Android without pong closed after %d protocol pings", pings.Load())
			}
		})
	}
}
