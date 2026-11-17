package main

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

const idleTestToken = "0123456789abcdef0123456789abcdef"

func idleTestInstance(port int) *WorkerInstance {
	inst := &WorkerInstance{
		Username: "admin", Port: port, token: "worker-secret", LastActive: time.Now(),
		done: make(chan struct{}), ready: make(chan struct{}), hasMasterPassword: true,
	}
	close(inst.ready)
	return inst
}

func idleTestGateway(inst *WorkerInstance) *MultiUserGateway {
	return &MultiUserGateway{
		workers:   map[string]*WorkerInstance{inst.Username: inst},
		usedPorts: map[int]bool{inst.Port: true}, workerIdleTimeout: 150 * time.Millisecond,
		users:     map[string]UserAccount{"admin": {Username: "admin", Role: "admin"}},
		jwtSecret: []byte("idle-regression-test-secret"),
	}
}

func idleTestRegistered(t *testing.T, gw *MultiUserGateway, inst *WorkerInstance, want bool) {
	t.Helper()
	gw.workersMu.Lock()
	got := gw.workers[inst.Username] == inst
	gw.workersMu.Unlock()
	if got != want {
		t.Fatalf("worker registered = %v, want %v", got, want)
	}
}

func idleTestAge(inst *WorkerInstance) {
	inst.mu.Lock()
	inst.LastActive = time.Now().Add(-time.Hour)
	inst.mu.Unlock()
}

func idleTestWaitSessions(t *testing.T, inst *WorkerInstance, want int) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for {
		inst.mu.Lock()
		got := inst.activeSessions
		inst.mu.Unlock()
		if got == want {
			return
		}
		if time.Now().After(deadline) {
			t.Fatalf("active sessions = %d, want %d", got, want)
		}
		time.Sleep(time.Millisecond)
	}
}

func idleTestRelay(t *testing.T, handler http.Handler) (*MultiUserGateway, *WorkerInstance, string, http.Header) {
	t.Helper()
	internal := httptest.NewServer(handler)
	t.Cleanup(internal.Close)
	worker := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("X-Uniterm-Worker-Token") != "worker-secret" {
			http.Error(w, "forbidden", http.StatusForbidden)
			return
		}
		switch r.URL.Path {
		case "/api/web/activity":
			_ = json.NewEncoder(w).Encode(map[string]int64{"lastActivityNano": 0})
		case "/api/web/session-proxy-lookup/" + idleTestToken:
			_ = json.NewEncoder(w).Encode(map[string]string{"addr": strings.TrimPrefix(internal.URL, "http://")})
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(worker.Close)
	port, err := strconv.Atoi(strings.TrimPrefix(worker.URL, "http://127.0.0.1:"))
	if err != nil {
		t.Fatal(err)
	}
	inst := idleTestInstance(port)
	gw := idleTestGateway(inst)
	relay := httptest.NewServer(gw)
	t.Cleanup(relay.Close)
	headers := http.Header{"Authorization": {"Bearer " + gw.signToken(SessionClaims{
		Username: "admin", Role: "admin", Iat: time.Now().Unix(), Exp: time.Now().Add(time.Hour).Unix(),
	})}}
	return gw, inst, relay.URL, headers
}

func idleTestEcho(w http.ResponseWriter, r *http.Request) {
	ws, err := (&websocket.Upgrader{CheckOrigin: func(*http.Request) bool { return true }}).Upgrade(w, r, nil)
	if err != nil {
		return
	}
	defer ws.Close()
	for {
		kind, data, err := ws.ReadMessage()
		if err != nil || ws.WriteMessage(kind, data) != nil {
			return
		}
	}
}

// A static desktop sends no frames. Its open, authenticated relay still has
// to protect the worker, and closing the last viewer must start a fresh idle
// interval instead of immediately reaping it using the upgrade timestamp.
func TestIdleReaperKeepsQuietSessionProxy(t *testing.T) {
	gw, inst, base, headers := idleTestRelay(t, http.HandlerFunc(idleTestEcho))
	ws, _, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(base, "http")+"/api/web/session-proxy/"+idleTestToken, headers)
	if err != nil {
		t.Fatal(err)
	}
	defer ws.Close()
	idleTestWaitSessions(t, inst, 1)
	time.Sleep(3 * gw.workerIdleTimeout)
	gw.reapIdleWorkers(time.Now())
	idleTestRegistered(t, gw, inst, true)
	if err := ws.WriteMessage(websocket.BinaryMessage, []byte("still connected")); err != nil {
		t.Fatal(err)
	}
	_ = ws.SetReadDeadline(time.Now().Add(time.Second))
	_, data, err := ws.ReadMessage()
	if err != nil || string(data) != "still connected" {
		t.Fatalf("relay after idle interval: %q, %v", data, err)
	}
	_ = ws.Close()
	idleTestWaitSessions(t, inst, 0)
	gw.reapIdleWorkers(time.Now())
	idleTestRegistered(t, gw, inst, true)
	idleTestAge(inst)
	gw.reapIdleWorkers(time.Now())
	idleTestRegistered(t, gw, inst, false)
}

func TestIdleReaperWaitsForLastSession(t *testing.T) {
	inst := idleTestInstance(1)
	gw := idleTestGateway(inst)
	releaseFirst, ok := gw.acquireWorkerActivity(inst, true)
	if !ok {
		t.Fatal("first lease rejected")
	}
	defer releaseFirst()
	releaseLast, ok := gw.acquireWorkerActivity(inst, true)
	if !ok {
		t.Fatal("second lease rejected")
	}
	defer releaseLast()
	idleTestWaitSessions(t, inst, 2)
	releaseFirst()
	idleTestAge(inst)
	gw.reapIdleWorkers(time.Now())
	idleTestWaitSessions(t, inst, 1)
	idleTestRegistered(t, gw, inst, true)
	releaseLast()
	idleTestWaitSessions(t, inst, 0)
	inst.mu.Lock()
	last := inst.LastActive
	inst.mu.Unlock()
	releaseLast()
	inst.mu.Lock()
	unchanged := inst.LastActive.Equal(last)
	inst.mu.Unlock()
	if !unchanged {
		t.Fatal("releasing the same lease twice changed the idle timer")
	}
	gw.reapIdleWorkers(time.Now())
	idleTestRegistered(t, gw, inst, true)
}

func TestSessionProxyFailuresReleaseActivity(t *testing.T) {
	for _, token := range []string{"missing-token", idleTestToken} {
		t.Run(token, func(t *testing.T) {
			gw, inst, base, headers := idleTestRelay(t, http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				http.Error(w, "upgrade rejected", http.StatusBadRequest)
			}))
			ws, resp, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(base, "http")+"/api/web/session-proxy/"+token, headers)
			if ws != nil {
				ws.Close()
			}
			if resp != nil {
				resp.Body.Close()
			}
			if err == nil {
				t.Fatal("expected failed lookup or upgrade")
			}
			idleTestWaitSessions(t, inst, 0)
			idleTestAge(inst)
			gw.reapIdleWorkers(time.Now())
			idleTestRegistered(t, gw, inst, false)
		})
	}
}

func TestSessionProxyFileTransferProtectsWorker(t *testing.T) {
	finish := make(chan struct{})
	var once sync.Once
	unblock := func() { once.Do(func() { close(finish) }) }
	defer unblock()
	gw, inst, base, headers := idleTestRelay(t, http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		<-finish
		_, _ = io.WriteString(w, "file content")
	}))
	result := make(chan error, 1)
	go func() {
		req, err := http.NewRequest(http.MethodGet, base+"/api/web/session-proxy/"+idleTestToken+"?op=download", nil)
		if err == nil {
			req.Header = headers
			var resp *http.Response
			resp, err = (&http.Client{Timeout: 2 * time.Second}).Do(req)
			if resp != nil {
				_, _ = io.Copy(io.Discard, resp.Body)
				resp.Body.Close()
			}
		}
		result <- err
	}()
	idleTestWaitSessions(t, inst, 1)
	idleTestAge(inst)
	gw.reapIdleWorkers(time.Now())
	idleTestRegistered(t, gw, inst, true)
	unblock()
	if err := <-result; err != nil {
		t.Fatal(err)
	}
	idleTestWaitSessions(t, inst, 0)
}

// Hold the network activity probe open to exercise the exact window in which
// an idle candidate can become active or be replaced before it is stopped.
func TestIdleReaperRechecksAfterActivityProbe(t *testing.T) {
	for _, activity := range []string{"session", "http", "replacement"} {
		t.Run(activity, func(t *testing.T) {
			entered, finish := make(chan struct{}), make(chan struct{})
			var once sync.Once
			unblock := func() { once.Do(func() { close(finish) }) }
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				close(entered)
				<-finish
				_ = json.NewEncoder(w).Encode(map[string]int64{"lastActivityNano": 0})
			}))
			defer server.Close()
			defer unblock()
			port, _ := strconv.Atoi(strings.TrimPrefix(server.URL, "http://127.0.0.1:"))
			inst := idleTestInstance(port)
			gw := idleTestGateway(inst)
			idleTestAge(inst)
			done := make(chan struct{})
			go func() { gw.reapIdleWorkers(time.Now()); close(done) }()
			select {
			case <-entered:
			case <-time.After(time.Second):
				t.Fatal("reaper did not check worker activity")
			}
			expected := inst
			if activity == "replacement" {
				expected = idleTestInstance(port + 1)
				idleTestAge(expected)
				gw.workersMu.Lock()
				gw.workers[inst.Username] = expected
				gw.usedPorts[expected.Port] = true
				gw.workersMu.Unlock()
			} else {
				release, ok := gw.acquireWorkerActivity(inst, activity == "session")
				if !ok {
					t.Fatal("activity on current instance rejected")
				}
				defer release()
			}
			unblock()
			select {
			case <-done:
			case <-time.After(time.Second):
				t.Fatal("reaper did not finish")
			}
			idleTestRegistered(t, gw, expected, true)
		})
	}
}

func TestWorkerActivityRejectsRetiredAndExitedInstances(t *testing.T) {
	for _, reason := range []string{"replaced", "exited"} {
		t.Run(reason, func(t *testing.T) {
			inst := idleTestInstance(1)
			gw := idleTestGateway(inst)
			if reason == "replaced" {
				gw.workers[inst.Username] = idleTestInstance(2)
			} else {
				close(inst.done)
			}
			release, ok := gw.acquireWorkerActivity(inst, true)
			if release != nil {
				release()
			}
			if ok {
				t.Fatal("lease on unavailable worker accepted")
			}
		})
	}
}

// An open app event stream must not keep an otherwise unused worker alive;
// only dedicated session relays receive a lifetime lease.
func TestOrdinaryRequestDoesNotPinIdleWorker(t *testing.T) {
	inst := idleTestInstance(1)
	gw := idleTestGateway(inst)
	idleTestAge(inst)
	release, ok := gw.acquireWorkerActivity(inst, false)
	if !ok {
		t.Fatal("ordinary request activity rejected")
	}
	defer release()
	idleTestWaitSessions(t, inst, 0)
	gw.reapIdleWorkers(time.Now())
	idleTestRegistered(t, gw, inst, true)
	idleTestAge(inst)
	// Deliberately do not release the ordinary request before the idle pass.
	gw.reapIdleWorkers(time.Now())
	idleTestRegistered(t, gw, inst, false)
}

func TestOldWorkerActivityReleaseDoesNotAffectReplacement(t *testing.T) {
	old := idleTestInstance(1)
	gw := idleTestGateway(old)
	release, ok := gw.acquireWorkerActivity(old, true)
	if !ok {
		t.Fatal("lease rejected")
	}
	fresh := idleTestInstance(2)
	fresh.activeSessions = 3
	before := fresh.LastActive
	gw.workers[old.Username] = fresh
	release()
	release()
	idleTestWaitSessions(t, old, 0)
	fresh.mu.Lock()
	untouched := fresh.activeSessions == 3 && fresh.LastActive.Equal(before)
	fresh.mu.Unlock()
	if !untouched {
		t.Fatal("release for retired worker modified replacement activity")
	}
}

func TestIdleReaperTerminatesWorkerAfterLastSession(t *testing.T) {
	gw := newTestGateway(t, true)
	gw.workerIdleTimeout = time.Second
	inst, err := gw.getOrSpawnWorker("admin", true)
	if err != nil {
		t.Fatal(err)
	}
	release, ok := gw.acquireWorkerActivity(inst, true)
	if !ok {
		t.Fatal("lease rejected")
	}
	defer release()
	idleTestAge(inst)
	gw.reapIdleWorkers(time.Now())
	select {
	case <-inst.done:
		t.Fatal("worker process terminated while viewer remained connected")
	default:
	}
	release()
	idleTestAge(inst)
	gw.reapIdleWorkers(time.Now())
	select {
	case <-inst.done:
	case <-time.After(time.Second):
		t.Fatal("idle worker process was not terminated")
	}
	idleTestRegistered(t, gw, inst, false)
}
