package session

import (
	"bytes"
	"context"
	"encoding/binary"
	"encoding/json"
	"github.com/gorilla/websocket"
	"io"
	"net/http"
	"os"
	"regexp"
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
	t.Setenv("HOME", t.TempDir())
	t.Setenv("PATH", t.TempDir()) // Entire test must work without an adb executable.
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

func TestAndroidPairingValidation(t *testing.T) {
	if e := PairAndroid("127.0.0.1", 37123, "invalid"); e == nil {
		t.Fatal("accepted bad code")
	}
	if e := PairAndroid("", 37123, "123456"); e == nil {
		t.Fatal("accepted invalid host")
	}
}

func TestAndroidRedroidMediaAndIsolation(t *testing.T) {
	if os.Getenv("UNITERM_ANDROID_LIVE") == "" {
		t.Skip("explicit local redroid fixture required")
	}
	t.Setenv("HOME", t.TempDir())
	t.Setenv("PATH", t.TempDir())
	first := NewAndroidSession("first")
	if e := first.Connect(ConnectionConfig{Host: "127.0.0.1", Port: 15555}); e != nil {
		t.Fatal(e)
	}
	defer first.Disconnect()
	second := NewAndroidSession("second")
	if e := second.Connect(ConnectionConfig{Host: "127.0.0.1", Port: 15555}); e != nil {
		t.Fatal(e)
	}
	defer second.Disconnect()
	if first.socket == second.socket {
		t.Fatal("sessions share socket")
	}
	first.Disconnect()
	ctx, cancel := context.WithTimeout(context.Background(), 25*time.Second)
	defer cancel()
	out, e := second.exec(ctx, "printf independent")
	if e != nil || string(out) != "independent" {
		t.Fatal("closing one session broke the other", e, string(out))
	}
	// Existing fixture clip is required only by this optional media test.
	out, e = second.exec(ctx, "test -f /sdcard/Download/uniterm-bbb-clip.mp4 && printf exists")
	if e != nil || string(out) != "exists" {
		t.Fatal("fixture movie missing", e)
	}
	second.exec(ctx, "am force-stop com.android.gallery3d")
	second.exec(ctx, "am start -a android.intent.action.VIEW -d file:///sdcard/Download/uniterm-bbb-clip.mp4 -t video/mp4")
	ws, _, e := websocket.DefaultDialer.Dial(second.ProxyAddr(), nil)
	if e != nil {
		t.Fatal(e)
	}
	defer ws.Close()
	ws.SetReadDeadline(time.Now().Add(15 * time.Second))
	video, audio, nonzero := 0, 0, 0
	start := time.Now()
	for time.Since(start) < 5*time.Second {
		kind, b, e := ws.ReadMessage()
		if e != nil {
			t.Fatal(e)
		}
		if kind == websocket.TextMessage {
			if bytes.Contains(b, []byte(`"error"`)) {
				t.Fatal(string(b))
			}
			continue
		}
		if len(b) < 13 {
			t.Fatal("short media")
		}
		if b[0] == 1 {
			video++
		} else if b[0] == 2 {
			audio++
			for _, v := range b[13:] {
				if v != 0 {
					nonzero++
					break
				}
			}
		}
	}
	if video < 30 || audio < 30 || nonzero == 0 {
		t.Fatalf("missing media video=%d audio=%d nonzero=%d", video, audio, nonzero)
	}
	ws.WriteJSON(map[string]any{"type": "key", "key": 3})
	time.Sleep(300 * time.Millisecond)
	out, e = second.exec(ctx, "dumpsys activity activities")
	if e != nil || !regexp.MustCompile(`mResumedActivity:.*com\.android\.launcher3/`).Match(out) {
		t.Fatal("Home control not applied", e)
	}
	t.Logf("no adb executable: independent sessions, %d video packets, %d audio packets, %d nonzero audio packets, Home control", video, audio, nonzero)
}

func TestAndroidVideoOptions(t *testing.T) {
	for _, source := range []string{"", "display", "front", "back"} {
		actual, options, err := androidVideoOptions(source)
		if err != nil || !strings.Contains(options, "audio_source=output") {
			t.Fatalf("%q: %s %v", source, options, err)
		}
		if source == "front" || source == "back" {
			if actual != source || !strings.Contains(options, "video_source=camera camera_facing="+source) {
				t.Fatal(options)
			}
		} else if actual != "display" || strings.Contains(options, "camera_facing") {
			t.Fatal(options)
		}
	}
	for _, source := range []string{"front;id", "back camera_id=0", "external", "camera", "$(id)"} {
		if _, _, err := androidVideoOptions(source); err == nil {
			t.Fatalf("accepted %q", source)
		}
	}
}

func TestAndroidResolutionCommand(t *testing.T) {
	for _, dims := range [][2]int{{720, 1280}, {1080, 2400}, {1440, 3200}, {320, 4096}} {
		command, err := (androidResolutionRequest{Width: dims[0], Height: dims[1]}).command()
		if err != nil || !strings.HasPrefix(command, "wm size ") {
			t.Fatalf("%s %v", command, err)
		}
	}
	for _, dims := range [][2]int{{0, 1280}, {319, 720}, {4097, 1080}, {720, -1}} {
		if _, err := (androidResolutionRequest{Width: dims[0], Height: dims[1]}).command(); err == nil {
			t.Fatal(dims)
		}
	}
	if command, err := (androidResolutionRequest{Reset: true}).command(); err != nil || command != "wm size reset && wm density reset" {
		t.Fatal(command, err)
	}
}

func TestAndroidResolutionDPIValidation(t *testing.T) {
	for _, dpi := range []int{120, 320, 480, 560, 960} {
		command, err := (androidResolutionRequest{Width: 1206, Height: 2622, DPI: dpi}).command()
		if err != nil || !strings.Contains(command, "&& wm density ") {
			t.Fatalf("%s %v", command, err)
		}
	}
	for _, dpi := range []int{-1, 119, 961} {
		if _, err := (androidResolutionRequest{Width: 1206, Height: 2622, DPI: dpi}).command(); err == nil {
			t.Fatal(dpi)
		}
	}
}
