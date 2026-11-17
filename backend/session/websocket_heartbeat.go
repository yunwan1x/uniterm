package session

import (
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

// Each session owns its settings. Zero values use the production intervals;
// tests may shorten them without changing concurrent sessions.
type sessionWebSocketHeartbeatOptions struct {
	interval     time.Duration
	pongTimeout  time.Duration
	writeTimeout time.Duration
}

// startSessionWebSocketHeartbeat must be called before the socket read loop,
// after any startup work that prevents it from consuming control frames.
// Browsers answer these protocol pings without frontend timers or media frames.
// A separate watchdog closes both transports even when a relay is blocked on
// an upstream write and cannot return to ReadMessage to observe a deadline.
func startSessionWebSocketHeartbeat(ws *websocket.Conn, options sessionWebSocketHeartbeatOptions, closeTransport func()) func() {
	if options.interval <= 0 {
		options.interval = 30 * time.Second
	}
	if options.pongTimeout <= 0 {
		options.pongTimeout = 90 * time.Second
	}
	if options.writeTimeout <= 0 {
		options.writeTimeout = 10 * time.Second
	}
	pong := make(chan struct{}, 1)
	ws.SetPongHandler(func(string) error {
		select {
		case pong <- struct{}{}:
		default:
		}
		return nil
	})
	stop := make(chan struct{})
	done := make(chan struct{})
	var once sync.Once
	go func() {
		defer close(done)
		tick := time.NewTicker(options.interval)
		defer tick.Stop()
		timeout := time.NewTimer(options.pongTimeout)
		defer timeout.Stop()
		closeStale := func() {
			ws.Close()
			if closeTransport != nil {
				closeTransport()
			}
		}
		for {
			select {
			case <-stop:
				return
			case <-pong:
				timeout.Reset(options.pongTimeout)
			case <-timeout.C:
				closeStale()
				return
			case <-tick.C:
				// WriteControl is safe alongside the relay's data writer.
				if err := ws.WriteControl(websocket.PingMessage, nil, time.Now().Add(options.writeTimeout)); err != nil {
					closeStale()
					return
				}
			}
		}
	}()
	return func() {
		once.Do(func() { close(stop) })
		<-done
	}
}
