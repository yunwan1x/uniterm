package main

import (
	"errors"
	"log"
	"sync"
	"time"
)

// workerForRequest acquires activity against the exact process returned by
// getOrSpawnWorker. A reaper may retire that process while it becomes ready,
// so retry against the replacement before forwarding the request.
func (gw *MultiUserGateway) workerForRequest(username string, pin bool) (*WorkerInstance, func(), error) {
	for attempt := 0; attempt < 3; attempt++ {
		inst, err := gw.getOrSpawnWorker(username, true)
		if err != nil {
			return nil, nil, err
		}
		if release, ok := gw.acquireWorkerActivity(inst, pin); ok {
			return inst, release, nil
		}
	}
	return nil, nil, errors.New("worker changed repeatedly while acquiring request activity")
}

// acquireWorkerActivity serializes new activity with idle retirement. Session
// relays remain active even when a remote desktop is static and sends no frames.
// Ordinary requests only touch the timestamp: an open app event socket alone
// must not prevent an otherwise unused worker from being reclaimed.
func (gw *MultiUserGateway) acquireWorkerActivity(inst *WorkerInstance, pin bool) (func(), bool) {
	gw.workersMu.Lock()
	if gw.workers[inst.Username] != inst {
		gw.workersMu.Unlock()
		return nil, false
	}
	select {
	case <-inst.done:
		gw.workersMu.Unlock()
		return nil, false
	default:
	}
	inst.mu.Lock()
	inst.LastActive = time.Now()
	if pin {
		inst.activeSessions++
	}
	inst.mu.Unlock()
	gw.workersMu.Unlock()

	if !pin {
		return func() {}, true
	}
	var once sync.Once
	return func() {
		once.Do(func() {
			// Release only the instance that was acquired, never a newer
			// process belonging to the same user.
			inst.mu.Lock()
			inst.activeSessions--
			if inst.activeSessions == 0 {
				inst.LastActive = time.Now()
			}
			inst.mu.Unlock()
		})
	}, true
}

// reapIdleWorkers probes event activity without holding locks, then rechecks
// instance identity and request/session activity before removing that exact
// process. Forced administrator stops deliberately do not use these idle checks.
func (gw *MultiUserGateway) reapIdleWorkers(now time.Time) {
	var candidates []*WorkerInstance
	gw.workersMu.Lock()
	for _, inst := range gw.workers {
		inst.mu.Lock()
		idle := inst.activeSessions == 0 && now.Sub(inst.LastActive) > gw.workerIdleTimeout
		inst.mu.Unlock()
		if idle {
			candidates = append(candidates, inst)
		}
	}
	gw.workersMu.Unlock()

	for _, inst := range candidates {
		// Terminal output uses the app event stream rather than a session
		// relay and remains covered by the worker's activity endpoint.
		if workerRecentlyActive(inst, gw.workerIdleTimeout) {
			continue
		}
		gw.workersMu.Lock()
		inst.mu.Lock()
		retire := gw.workers[inst.Username] == inst &&
			inst.activeSessions == 0 && now.Sub(inst.LastActive) > gw.workerIdleTimeout
		if retire {
			delete(gw.workers, inst.Username)
			delete(gw.usedPorts, inst.Port)
		}
		inst.mu.Unlock()
		gw.workersMu.Unlock()
		if retire {
			log.Printf("[uniterm-gateway] Stopping idle worker for user=%s", inst.Username)
			terminateWorkerInstance(inst)
		}
	}
}
