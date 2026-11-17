package session

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"net"
	"net/http"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	"github.com/ys-ll/uniterm/backend/log"
)

// VNCProxy bridges WebSocket (frontend noVNC) to TCP (VNC server).
// One instance per VNC session, bound to a random local port.
type VNCProxy struct {
	listener net.Listener
	target   string
	// authToken scopes the proxy's path in server mode; also the registry
	// key for the /api/web dispatch.
	authToken string
	ctx       context.Context
	cancel    context.CancelFunc
	stopped   bool
	heartbeat sessionWebSocketHeartbeatOptions
	wg        sync.WaitGroup
	mu        sync.Mutex
	wsConn    *websocket.Conn
	tcpConn   net.Conn
}

func NewVNCProxy(target string) *VNCProxy {
	ctx, cancel := context.WithCancel(context.Background())
	return &VNCProxy{target: target, ctx: ctx, cancel: cancel}
}

// Start begins listening on a random local port and returns the WebSocket URL.
func (p *VNCProxy) Start() (string, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.stopped {
		return "", fmt.Errorf("vnc proxy stopped")
	}
	if p.listener != nil {
		return "", fmt.Errorf("vnc proxy already started")
	}
	var token [16]byte
	if _, err := rand.Read(token[:]); err != nil {
		return "", fmt.Errorf("vnc proxy token: %w", err)
	}
	p.authToken = hex.EncodeToString(token[:])

	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return "", fmt.Errorf("vnc proxy listen: %w", err)
	}
	p.listener = ln

	upgrader := websocket.Upgrader{
		CheckOrigin: func(r *http.Request) bool { return true },
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		ws, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			log.Writef("[VNCProxy] WebSocket upgrade failed: %v", err)
			return
		}
		p.handleWebSocket(ws)
	})
	// Also reachable through the server build's /api/web mount: the gateway
	// resolves the internal listener via the lookup endpoint and relays the
	// upgrade here (the asset server itself cannot upgrade).
	addr := ln.Addr().(*net.TCPAddr)
	registerSessionProxyHandler(p.authToken, mux, addr.String())

	p.wg.Add(1)
	go func() {
		defer p.wg.Done()
		_ = http.Serve(ln, mux)
	}()

	log.Writef("[VNCProxy] Listening on ws://127.0.0.1:%d, target: %s", addr.Port, p.target)
	return sessionProxyAddress(p.authToken, fmt.Sprintf("ws://127.0.0.1:%d", addr.Port)), nil
}

func (p *VNCProxy) handleWebSocket(ws *websocket.Conn) {
	defer ws.Close()
	p.mu.Lock()
	if p.stopped || p.wsConn != nil {
		p.mu.Unlock()
		log.Writef("[VNCProxy] Rejecting additional or stopped WebSocket connection")
		return
	}
	p.wsConn = ws
	// Stop sets stopped under the same mutex before waiting, so no handler
	// can add to the wait group after shutdown starts.
	p.wg.Add(1)
	p.mu.Unlock()
	defer p.wg.Done()
	defer func() {
		p.mu.Lock()
		if p.wsConn == ws {
			p.wsConn, p.tcpConn = nil, nil
		}
		p.mu.Unlock()
	}()
	log.Writef("[VNCProxy] WebSocket client connected")

	dialer := net.Dialer{Timeout: 5 * time.Second}
	tcp, err := dialer.DialContext(p.ctx, "tcp", p.target)
	if err != nil {
		log.Writef("[VNCProxy] TCP dial to %s failed: %v", p.target, err)
		return
	}
	defer tcp.Close()
	p.mu.Lock()
	if p.stopped {
		p.mu.Unlock()
		return
	}
	p.tcpConn = tcp
	p.mu.Unlock()
	log.Writef("[VNCProxy] TCP connection to %s established", p.target)

	stopHeartbeat := startSessionWebSocketHeartbeat(ws, p.heartbeat, func() { tcp.Close() })
	defer stopHeartbeat()
	readDone := make(chan struct{})
	go func() {
		defer close(readDone)
		defer tcp.Close()
		defer ws.Close()
		for {
			msgType, data, err := ws.ReadMessage()
			if err != nil {
				return
			}
			if msgType == websocket.BinaryMessage {
				if _, err := tcp.Write(data); err != nil {
					return
				}
			}
		}
	}()
	defer func() {
		tcp.Close()
		ws.Close()
		<-readDone
	}()
	// Keep ownership until both directions stop; returning immediately used
	// to clear wsConn while the old relay was still consuming the stream.
	buf := make([]byte, 32768)
	for {
		n, err := tcp.Read(buf)
		if n > 0 {
			if writeErr := ws.WriteMessage(websocket.BinaryMessage, buf[:n]); writeErr != nil {
				return
			}
		}
		if err != nil {
			return
		}
	}
}

// Stop closes all connections and waits for their owning handlers to exit.
func (p *VNCProxy) Stop() {
	p.mu.Lock()
	p.stopped = true
	p.cancel()
	unregisterSessionProxyHandler(p.authToken)
	if p.wsConn != nil {
		p.wsConn.Close()
	}
	if p.tcpConn != nil {
		p.tcpConn.Close()
	}
	if p.listener != nil {
		p.listener.Close()
	}
	p.mu.Unlock()
	p.wg.Wait()
}
