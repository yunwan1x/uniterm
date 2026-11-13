package session

import (
	"bytes"
	"encoding/binary"
	"encoding/json"
	"github.com/gorilla/websocket"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

func TestAndroidAddress(t *testing.T) {
	for _, host := range []string{"", "-x", "a b", "a\n", "a/b"} {
		if _, e := androidAddress(host, 5555); e == nil {
			t.Fatal(host)
		}
	}
	if s, e := androidAddress("::1", 5555); e != nil || s != "[::1]:5555" {
		t.Fatal(s, e)
	}
}
func TestAndroidControl(t *testing.T) {
	p, e := androidControl([]byte(`{"type":"key","key":3}`))
	if e != nil || len(p) != 28 || p[15] != 1 || binary.BigEndian.Uint32(p[16:]) != 3 {
		t.Fatal(p, e)
	}
	p, e = androidControl([]byte(`{"type":"touch","action":0,"x":12,"y":34,"width":720,"height":1280}`))
	if e != nil || len(p) != 32 || binary.BigEndian.Uint32(p[10:]) != 12 || binary.BigEndian.Uint16(p[20:]) != 1280 {
		t.Fatal(p, e)
	}
	for _, v := range []string{`{"type":"touch","width":0}`, `{"type":"touch","action":9}`, `{"type":"key","key":999}`, `{"type":"exec"}`} {
		if _, e = androidControl([]byte(v)); e == nil {
			t.Fatal(v)
		}
	}
}
func TestAndroidRedroidLive(t *testing.T) {
	if os.Getenv("UNITERM_ANDROID_LIVE") == "" {
		t.Skip("explicit local redroid fixture required")
	}
	defer CloseAndroidADB()
	s := NewAndroidSession("android-live")
	if e := s.Connect(ConnectionConfig{Host: "127.0.0.1", Port: 15555}); e != nil {
		t.Fatal(e)
	}
	defer s.Disconnect()
	// Connect immediately to cover the scrcpy startup race.
	ws, _, e := websocket.DefaultDialer.Dial(s.ProxyAddr(), nil)
	if e != nil {
		t.Fatal(e)
	}
	defer ws.Close()
	ws.SetReadDeadline(time.Now().Add(20 * time.Second))
	frames := 0
	for frames < 3 {
		kind, b, e := ws.ReadMessage()
		if e != nil {
			t.Fatal(e)
		}
		if kind == websocket.TextMessage {
			var v map[string]any
			json.Unmarshal(b, &v)
			if v["error"] != nil {
				t.Fatal(v)
			}
			t.Log(string(b))
		} else if len(b) > 13 && b[0] == 1 {
			frames++
		}
	}
	ws.WriteJSON(map[string]any{"type": "key", "key": 3})
	url := "http" + s.ProxyAddr()[2:] + "?op=upload&path=/sdcard/Download/uniterm-live.bin"
	data := bytes.Repeat([]byte{0, 1, 255, 10, 42}, 200000)
	resp, e := http.Post(url, "application/octet-stream", bytes.NewReader(data))
	if e != nil {
		t.Fatal(e)
	}
	resp.Body.Close()
	if resp.StatusCode != 204 {
		t.Fatal(resp.Status)
	}
	resp, e = http.Get("http" + s.ProxyAddr()[2:] + "?op=download&path=/sdcard/Download/uniterm-live.bin")
	if e != nil {
		t.Fatal(e)
	}
	got, e := io.ReadAll(resp.Body)
	resp.Body.Close()
	if e != nil || !bytes.Equal(got, data) {
		t.Fatalf("round trip failed: %s %d %v", resp.Status, len(got), e)
	}
	for _, suffix := range []string{"?op=download&path=/etc/passwd", "?op=download&path=/sdcard/Download/missing-test-file"} {
		r, e := http.Get("http" + s.ProxyAddr()[2:] + suffix)
		if e != nil {
			t.Fatal(e)
		}
		r.Body.Close()
		if r.StatusCode < 400 {
			t.Fatal("unexpected path success", r.Status)
		}
	}
	s.Disconnect()
	if _, ok := LookupSessionProxyAddr(s.token); ok {
		t.Fatal("proxy remains after disconnect")
	}
	t.Logf("PASS real redroid: %d video packets, Home input, %d byte upload/download identical", frames, len(data))
}

func TestAndroidUnicodePaste(t *testing.T) {
	p, e := androidControl([]byte(`{"type":"paste","text":"你好 Android"}`))
	if e != nil {
		t.Fatal(e)
	}
	if p[0] != 9 || p[9] != 1 || int(binary.BigEndian.Uint32(p[10:])) != len([]byte("你好 Android")) || string(p[14:]) != "你好 Android" {
		t.Fatal("bad clipboard packet")
	}
}

func TestAndroidPairingCodeIsTransient(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("POSIX fake adb")
	}
	CloseAndroidADB()
	defer CloseAndroidADB()
	dir := t.TempDir()
	bin := filepath.Join(dir, "adb")
	record := filepath.Join(dir, "pair-input")
	script := `#!/bin/sh
case "$3" in
 start-server|kill-server) exit 0;;
 pair) printf '%s\n' "$@" > "$PAIR_RECORD"; read code; printf '%s' "$code" >> "$PAIR_RECORD"; echo 'Successfully paired';;
esac
`
	if e := os.WriteFile(bin, []byte(script), 0700); e != nil {
		t.Fatal(e)
	}
	t.Setenv("UNITERM_ADB_BIN", bin)
	t.Setenv("PAIR_RECORD", record)
	if e := PairAndroid("127.0.0.1", 37123, "123456"); e != nil {
		t.Fatal(e)
	}
	b, e := os.ReadFile(record)
	if e != nil {
		t.Fatal(e)
	}
	lines := strings.Split(string(b), "\n")
	if len(lines) != 5 || lines[2] != "pair" || lines[3] != "127.0.0.1:37123" || lines[4] != "123456" {
		t.Fatal("pair invocation did not use stdin for code")
	}
	if e := PairAndroid("127.0.0.1", 37123, "invalid"); e == nil {
		t.Fatal("accepted bad code")
	}
}
