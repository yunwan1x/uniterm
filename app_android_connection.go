package main

import "github.com/ys-ll/uniterm/backend/session"

func (a *App) AndroidPair(host string, port int, code string) error {
	return session.PairAndroid(host, port, code)
}
