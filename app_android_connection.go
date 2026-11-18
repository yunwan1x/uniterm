package main

import (
	"fmt"

	"github.com/ys-ll/uniterm/backend/session"
)

func (a *App) AndroidPair(host string, port int, code string) error {
	return session.PairAndroid(host, port, code)
}

func (a *App) CloseAndroidSessionForReconnect(id string) error {
	if a.sessionManager == nil {
		return fmt.Errorf("session manager not initialized")
	}
	s, ok := a.sessionManager.Get(id)
	if !ok {
		return nil
	}
	android, ok := s.(*session.AndroidSession)
	if !ok {
		return fmt.Errorf("not an Android session")
	}
	if err := android.DisconnectForReconnect(); err != nil {
		return err
	}
	return a.CloseSession(id)
}
