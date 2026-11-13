package session

import (
	"context"
	"crypto/rand"
	_ "embed"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

//go:embed androidassets/scrcpy-server-v3.3.4.jar
var androidServer []byte

// A private ADB daemon per worker keeps devices and keys out of the host's global daemon.
var androidADB struct {
	sync.Mutex
	port string
}

func androidADBEnv() []string {
	env := []string{}
	for _, entry := range os.Environ() {
		if strings.HasPrefix(entry, "ADB_SERVER_SOCKET=") || strings.HasPrefix(entry, "ADB_VENDOR_KEYS=") || strings.HasPrefix(entry, "ANDROID_USER_HOME=") || strings.HasPrefix(entry, "ANDROID_SDK_HOME=") {
			continue
		}
		env = append(env, entry)
	}
	home, _ := os.UserHomeDir()
	return append(env, "ANDROID_USER_HOME="+filepath.Join(home, ".android"))
}

func adbCommand(ctx context.Context, args ...string) (*exec.Cmd, error) {
	androidADB.Lock()
	defer androidADB.Unlock()
	bin := os.Getenv("UNITERM_ADB_BIN")
	if bin == "" {
		bin = "adb"
	}
	if _, err := exec.LookPath(bin); err != nil {
		return nil, fmt.Errorf("Android requires adb (android-tools): %w", err)
	}
	if androidADB.port == "" {
		ln, err := net.Listen("tcp", "127.0.0.1:0")
		if err != nil {
			return nil, err
		}
		port := strconv.Itoa(ln.Addr().(*net.TCPAddr).Port)
		ln.Close()
		cmd := exec.CommandContext(ctx, bin, "-P", port, "start-server")
		cmd.Env = androidADBEnv()
		if out, err := cmd.CombinedOutput(); err != nil {
			return nil, fmt.Errorf("start private adb: %s: %w", out, err)
		}
		androidADB.port = port
	}
	cmd := exec.CommandContext(ctx, bin, append([]string{"-P", androidADB.port}, args...)...)
	cmd.Env = androidADBEnv()
	return cmd, nil
}
func adbRun(ctx context.Context, args ...string) ([]byte, error) {
	c, e := adbCommand(ctx, args...)
	if e != nil {
		return nil, e
	}
	b, e := c.CombinedOutput()
	if e != nil {
		return nil, fmt.Errorf("adb: %s: %w", strings.TrimSpace(string(b)), e)
	}
	return b, nil
}
func androidAddress(host string, port int) (string, error) {
	if host == "" || strings.ContainsAny(host, " \t\r\n/\\") || strings.HasPrefix(host, "-") || port < 1 || port > 65535 {
		return "", fmt.Errorf("invalid Android host or port")
	}
	return net.JoinHostPort(strings.Trim(host, "[]"), strconv.Itoa(port)), nil
}
func PairAndroid(host string, port int, code string) error {
	address, e := androidAddress(host, port)
	if e != nil {
		return e
	}
	if !regexp.MustCompile(`^[0-9]{6}$`).MatchString(code) {
		return fmt.Errorf("pairing code must contain 6 digits")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	c, e := adbCommand(ctx, "pair", address)
	if e != nil {
		return e
	}
	c.Stdin = strings.NewReader(code + "\n")
	out, e := c.CombinedOutput()
	if e != nil || !strings.Contains(string(out), "Successfully paired") {
		return fmt.Errorf("wireless pairing failed; check pairing port, code and device reachability")
	}
	return nil
}

type AndroidSession struct {
	baseSession
	ctx                                          context.Context
	cancel                                       context.CancelFunc
	proxyAddr, token, target, forward, remoteJar string
	listener                                     net.Listener
	process                                      *exec.Cmd
	mu                                           sync.Mutex
	controlMu                                    sync.Mutex
	sockets                                      []net.Conn
	ws                                           *websocket.Conn
	serving                                      bool
	once                                         sync.Once
}

func NewAndroidSession(id string) *AndroidSession {
	return &AndroidSession{baseSession: baseSession{id: id, sessionType: "android", status: StatusDisconnected}}
}
func (s *AndroidSession) ProxyAddr() string     { return s.proxyAddr }
func (s *AndroidSession) IsConnected() bool     { return s.Status() == StatusConnected }
func (s *AndroidSession) Resize(int, int) error { return nil }
func (s *AndroidSession) Write([]byte) error    { return nil }
func (s *AndroidSession) Connect(cfg ConnectionConfig) (err error) {
	s.setStatus(StatusConnecting)
	s.ctx, s.cancel = context.WithCancel(context.Background())
	defer func() {
		if err != nil {
			s.Disconnect()
			s.setStatus(StatusError)
		}
	}()
	port := cfg.Port
	if port == 0 {
		port = 5555
	}
	s.target, err = androidAddress(cfg.Host, port)
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(s.ctx, 45*time.Second)
	defer cancel()
	var out []byte
	for attempt := 0; attempt < 8; attempt++ {
		out, err = adbRun(ctx, "connect", s.target)
		if err == nil && strings.Contains(string(out), "connected to") {
			_, err = adbRun(ctx, "-s", s.target, "get-state")
			if err == nil {
				break
			}
			if strings.Contains(err.Error(), "unauthorized") {
				return fmt.Errorf("authorize this device or pair wireless debugging first: %w", err)
			}
		} else if err == nil {
			err = fmt.Errorf("ADB connect: %s", strings.TrimSpace(string(out)))
		}
		if ctx.Err() != nil {
			return ctx.Err()
		}
		// A restarted device can leave a stale offline transport in adb.
		// Only remove that failed transport, never an online device's connection.
		adbRun(ctx, "disconnect", s.target)
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(400 * time.Millisecond):
		}
	}
	if err != nil {
		return fmt.Errorf("Android device is offline or unreachable: %w", err)
	}
	var b [16]byte
	if _, err = rand.Read(b[:]); err != nil {
		return err
	}
	s.token = hex.EncodeToString(b[:])
	scid := fmt.Sprintf("%08x", binary.BigEndian.Uint32(b[:4])&0x7fffffff)
	f, err := os.CreateTemp("", "uniterm-scrcpy-*.jar")
	if err != nil {
		return err
	}
	defer os.Remove(f.Name())
	if _, err = f.Write(androidServer); err != nil {
		f.Close()
		return err
	}
	f.Close()
	s.remoteJar = "/data/local/tmp/uniterm-" + s.token + ".jar"
	if _, err = adbRun(ctx, "-s", s.target, "push", f.Name(), s.remoteJar); err != nil {
		return err
	}
	out, err = adbRun(ctx, "-s", s.target, "forward", "tcp:0", "localabstract:scrcpy_"+scid)
	if err != nil {
		return err
	}
	s.forward = strings.TrimSpace(string(out))
	s.process, err = adbCommand(s.ctx, "-s", s.target, "shell", "CLASSPATH="+s.remoteJar, "app_process", "/", "com.genymobile.scrcpy.Server", "3.3.4", "scid="+scid, "tunnel_forward=true", "audio=true", "audio_codec=raw", "video_codec=h264", "video_codec_options=profile=1,level=2048", "max_size=1280", "max_fps=30", "video_bit_rate=4000000", "send_device_meta=false", "send_dummy_byte=true", "clipboard_autosync=false")
	if err != nil {
		return err
	}
	if err = s.process.Start(); err != nil {
		return err
	}
	go func() { s.process.Wait() }()
	s.listener, err = net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return err
	}
	handler := http.HandlerFunc(s.handle)
	registerSessionProxyHandler(s.token, handler, s.listener.Addr().String())
	go http.Serve(s.listener, handler)
	s.proxyAddr = sessionProxyAddress(s.token, "ws://"+s.listener.Addr().String()+"/"+s.token)
	s.title = cfg.Name
	s.setStatus(StatusConnected)
	return nil
}
func (s *AndroidSession) Disconnect() error {
	s.once.Do(func() {
		if s.cancel != nil {
			s.cancel()
		}
		unregisterSessionProxyHandler(s.token)
		s.mu.Lock()
		if s.listener != nil {
			s.listener.Close()
		}
		if s.ws != nil {
			s.ws.Close()
		}
		for _, c := range s.sockets {
			c.Close()
		}
		s.mu.Unlock()
		if s.forward != "" || s.remoteJar != "" {
			ctx, c := context.WithTimeout(context.Background(), 3*time.Second)
			defer c()
			if s.forward != "" {
				adbRun(ctx, "-s", s.target, "forward", "--remove", "tcp:"+s.forward)
			}
			if s.remoteJar != "" {
				adbRun(ctx, "-s", s.target, "shell", "rm", "-f", s.remoteJar)
			}
		}
		s.setStatus(StatusDisconnected)
	})
	return nil
}
func (s *AndroidSession) dial() (net.Conn, error) {
	var conn net.Conn
	var err error
	for i := 0; i < 60; i++ {
		conn, err = net.DialTimeout("tcp", net.JoinHostPort("127.0.0.1", s.forward), time.Second)
		if err == nil {
			break
		}
		select {
		case <-s.ctx.Done():
			return nil, s.ctx.Err()
		case <-time.After(100 * time.Millisecond):
		}
	}
	if err != nil {
		return nil, err
	}
	s.mu.Lock()
	if s.ctx.Err() != nil {
		s.mu.Unlock()
		conn.Close()
		return nil, s.ctx.Err()
	}
	s.sockets = append(s.sockets, conn)
	s.mu.Unlock()
	return conn, nil
}
func (s *AndroidSession) handle(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/"+s.token {
		http.NotFound(w, r)
		return
	}
	if origin := r.Header.Get("Origin"); origin != "" {
		w.Header().Set("Access-Control-Allow-Origin", origin)
		w.Header().Set("Vary", "Origin")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
	}
	if r.Method == "OPTIONS" {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	if r.URL.Query().Get("op") != "" {
		s.files(w, r)
		return
	}
	s.mu.Lock()
	if s.serving {
		s.mu.Unlock()
		http.Error(w, "session already viewed; reconnect", 409)
		return
	}
	s.serving = true
	s.mu.Unlock()
	up := websocket.Upgrader{CheckOrigin: func(r *http.Request) bool { return true }}
	ws, err := up.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	s.mu.Lock()
	s.ws = ws
	s.mu.Unlock()
	defer s.Disconnect()
	var sendMu sync.Mutex
	send := func(kind int, data []byte) error {
		sendMu.Lock()
		defer sendMu.Unlock()
		ws.SetWriteDeadline(time.Now().Add(10 * time.Second))
		return ws.WriteMessage(kind, data)
	}
	fail := func(e error) {
		data, _ := json.Marshal(map[string]string{"error": e.Error()})
		send(websocket.TextMessage, data)
	}
	var video net.Conn
	for attempt := 0; attempt < 100; attempt++ {
		video, err = s.dial()
		if err != nil {
			break
		}
		video.SetReadDeadline(time.Now().Add(time.Second))
		dummy := make([]byte, 1)
		_, err = io.ReadFull(video, dummy)
		if err == nil {
			video.SetReadDeadline(time.Time{})
			break
		}
		video.Close()
		select {
		case <-s.ctx.Done():
			return
		case <-time.After(100 * time.Millisecond):
		}
	}
	if err != nil {
		fail(fmt.Errorf("scrcpy failed to start: %w", err))
		return
	}
	audio, err := s.dial()
	if err != nil {
		fail(err)
		return
	}
	control, err := s.dial()
	if err != nil {
		fail(err)
		return
	}
	header := make([]byte, 12)
	video.SetReadDeadline(time.Now().Add(20 * time.Second))
	if _, err = io.ReadFull(video, header); err != nil {
		fail(err)
		return
	}
	video.SetReadDeadline(time.Time{})
	meta, _ := json.Marshal(map[string]any{"width": binary.BigEndian.Uint32(header[4:8]), "height": binary.BigEndian.Uint32(header[8:12]), "codec": "h264"})
	send(websocket.TextMessage, meta)
	go func() {
		if err := s.media(video, 1, send); err != nil {
			ws.Close()
		}
	}()
	go func() {
		h := make([]byte, 4)
		if _, e := io.ReadFull(audio, h); e == nil && binary.BigEndian.Uint32(h) > 1 {
			s.media(audio, 2, send)
		}
	}()
	go io.Copy(io.Discard, control)
	ws.SetReadLimit(64 * 1024)
	for {
		_, data, e := ws.ReadMessage()
		if e != nil {
			return
		}
		packet, e := androidControl(data)
		if e != nil {
			fail(e)
			continue
		}
		s.controlMu.Lock()
		_, e = control.Write(packet)
		s.controlMu.Unlock()
		if e != nil {
			return
		}
	}
}
func (s *AndroidSession) media(c net.Conn, channel byte, send func(int, []byte) error) error {
	for {
		header := make([]byte, 12)
		if _, e := io.ReadFull(c, header); e != nil {
			return e
		}
		size := binary.BigEndian.Uint32(header[8:])
		if size > 16*1024*1024 {
			return fmt.Errorf("oversized media packet")
		}
		packet := make([]byte, 13+int(size))
		packet[0] = channel
		copy(packet[1:], header)
		if _, e := io.ReadFull(c, packet[13:]); e != nil {
			return e
		}
		if e := send(websocket.BinaryMessage, packet); e != nil {
			return e
		}
	}
}
func androidControl(data []byte) ([]byte, error) {
	var m struct {
		ScrollX       int16  `json:"scrollX"`
		ScrollY       int16  `json:"scrollY"`
		Type          string `json:"type"`
		Key           uint32 `json:"key"`
		Action        byte   `json:"action"`
		X, Y          uint32
		Width, Height uint16
		Text          string `json:"text"`
	}
	if e := json.Unmarshal(data, &m); e != nil {
		return nil, e
	}
	switch m.Type {
	case "key":
		if m.Key > 300 {
			return nil, fmt.Errorf("invalid key")
		}
		p := make([]byte, 28)
		p[0] = 0
		p[1] = 0
		binary.BigEndian.PutUint32(p[2:], m.Key)
		p[14] = 0
		p[15] = 1
		binary.BigEndian.PutUint32(p[16:], m.Key)
		return p, nil
	case "touch":
		if m.Action > 2 || m.Width == 0 || m.Height == 0 || m.X >= uint32(m.Width) || m.Y >= uint32(m.Height) {
			return nil, fmt.Errorf("invalid touch")
		}
		p := make([]byte, 32)
		p[0] = 2
		p[1] = m.Action
		binary.BigEndian.PutUint64(p[2:], ^uint64(0))
		binary.BigEndian.PutUint32(p[10:], m.X)
		binary.BigEndian.PutUint32(p[14:], m.Y)
		binary.BigEndian.PutUint16(p[18:], m.Width)
		binary.BigEndian.PutUint16(p[20:], m.Height)
		if m.Action != 1 {
			binary.BigEndian.PutUint16(p[22:], 65535)
			binary.BigEndian.PutUint32(p[28:], 1)
		}
		binary.BigEndian.PutUint32(p[24:], 1)
		return p, nil
	case "text":
		if len(m.Text) > 4096 {
			return nil, fmt.Errorf("text too long")
		}
		p := make([]byte, 5+len(m.Text))
		p[0] = 1
		binary.BigEndian.PutUint32(p[1:], uint32(len(m.Text)))
		copy(p[5:], m.Text)
		return p, nil
	case "scroll":
		if m.Width == 0 || m.Height == 0 || m.X >= uint32(m.Width) || m.Y >= uint32(m.Height) {
			return nil, fmt.Errorf("invalid scroll")
		}
		p := make([]byte, 21)
		p[0] = 3
		binary.BigEndian.PutUint32(p[1:], m.X)
		binary.BigEndian.PutUint32(p[5:], m.Y)
		binary.BigEndian.PutUint16(p[9:], m.Width)
		binary.BigEndian.PutUint16(p[11:], m.Height)
		binary.BigEndian.PutUint16(p[13:], uint16(m.ScrollX))
		binary.BigEndian.PutUint16(p[15:], uint16(m.ScrollY))
		return p, nil
	case "paste":
		if len(m.Text) > 4096 {
			return nil, fmt.Errorf("text too long")
		}
		p := make([]byte, 14+len(m.Text))
		p[0] = 9
		p[9] = 1
		binary.BigEndian.PutUint32(p[10:], uint32(len(m.Text)))
		copy(p[14:], m.Text)
		return p, nil
	case "rotate":
		return []byte{11}, nil
	}
	return nil, fmt.Errorf("unsupported Android action")
}
func (s *AndroidSession) files(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(s.ctx, 2*time.Minute)
	defer cancel()
	path := r.URL.Query().Get("path")
	if r.URL.Query().Get("op") == "shell" {
		if r.Method != "POST" {
			http.Error(w, "POST required", 405)
			return
		}
		body, e := io.ReadAll(http.MaxBytesReader(w, r.Body, 8192))
		if e != nil {
			http.Error(w, e.Error(), 400)
			return
		}
		ctx, stop := context.WithTimeout(ctx, 15*time.Second)
		defer stop()
		c, e := adbCommand(ctx, "-s", s.target, "shell", string(body))
		if e != nil {
			http.Error(w, e.Error(), 500)
			return
		}
		out, e := c.StdoutPipe()
		if e != nil {
			http.Error(w, e.Error(), 500)
			return
		}
		c.Stderr = c.Stdout
		if e = c.Start(); e != nil {
			http.Error(w, e.Error(), 500)
			return
		}
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		io.Copy(w, io.LimitReader(out, 1024*1024))
		stop()
		c.Wait()
		return
	}
	if !strings.HasPrefix(path, "/sdcard/") || strings.ContainsAny(path, "\x00\r\n") || strings.Contains(path, "..") {
		http.Error(w, "path must be inside /sdcard/", 400)
		return
	}
	switch r.URL.Query().Get("op") {
	case "upload":
		if r.Method != "POST" {
			http.Error(w, "POST required", 405)
			return
		}
		f, e := os.CreateTemp("", "uniterm-android-upload-*")
		if e != nil {
			http.Error(w, e.Error(), 500)
			return
		}
		defer os.Remove(f.Name())
		defer f.Close()
		if _, e = io.Copy(f, http.MaxBytesReader(w, r.Body, 256*1024*1024)); e != nil {
			http.Error(w, e.Error(), 413)
			return
		}
		f.Close()
		if _, e = adbRun(ctx, "-s", s.target, "push", f.Name(), path); e != nil {
			http.Error(w, e.Error(), 502)
			return
		}
		w.WriteHeader(204)
	case "download":
		if r.Method != "GET" {
			http.Error(w, "GET required", 405)
			return
		}
		sizeText, e := adbRun(ctx, "-s", s.target, "shell", "stat", "-c", "%s", "'"+strings.ReplaceAll(path, "'", "'\\''")+"'")
		size, parseErr := strconv.ParseInt(strings.TrimSpace(string(sizeText)), 10, 64)
		if e != nil || parseErr != nil {
			http.Error(w, "remote file not found or unreadable", 404)
			return
		}
		if size < 0 || size > 256*1024*1024 {
			http.Error(w, "maximum file size is 256 MiB", 413)
			return
		}
		w.Header().Set("Content-Length", strconv.FormatInt(size, 10))
		c, e := adbCommand(ctx, "-s", s.target, "exec-out", "cat", path)
		if e != nil {
			http.Error(w, e.Error(), 500)
			return
		}
		out, e := c.StdoutPipe()
		if e != nil {
			http.Error(w, e.Error(), 500)
			return
		}
		if e = c.Start(); e != nil {
			http.Error(w, e.Error(), 500)
			return
		}
		w.Header().Set("Content-Type", "application/octet-stream")
		io.CopyN(w, out, size)
		cancel()
		c.Wait()
	default:
		http.Error(w, "unknown operation", 400)
	}
}

func CloseAndroidADB() {
	androidADB.Lock()
	defer androidADB.Unlock()
	if androidADB.port == "" {
		return
	}
	bin := os.Getenv("UNITERM_ADB_BIN")
	if bin == "" {
		bin = "adb"
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, bin, "-P", androidADB.port, "kill-server")
	cmd.Env = androidADBEnv()
	cmd.Run()
	androidADB.port = ""
}
