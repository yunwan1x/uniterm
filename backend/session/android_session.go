package session

import (
	"bytes"
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
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	adb "github.com/juanlianyangyang/adb-go/adb"
)

//go:embed androidassets/scrcpy-server-v3.3.4.jar
var androidServer []byte

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
	key, e := androidPrivateKey()
	if e != nil {
		return e
	}
	if e = adb.Pair(ctx, address, code, key, "uniterm"); e != nil {
		return fmt.Errorf("wireless pairing failed; check pairing port, code and device reachability")
	}
	return nil
}

type AndroidSession struct {
	displayMu sync.Mutex
	baseSession
	ctx                                         context.Context
	cancel                                      context.CancelFunc
	proxyAddr, token, target, socket, remoteJar string
	listener                                    net.Listener
	process                                     io.ReadWriteCloser
	client                                      *adb.Client
	stopClient                                  func() bool
	mu                                          sync.Mutex
	controlMu                                   sync.Mutex
	sockets                                     []io.ReadWriteCloser
	ws                                          *websocket.Conn
	serving                                     bool
	videoSource                                 string
	once                                        sync.Once
}

func NewAndroidSession(id string) *AndroidSession {
	return &AndroidSession{baseSession: baseSession{id: id, sessionType: "android", status: StatusDisconnected}}
}
func (s *AndroidSession) ProxyAddr() string     { return s.proxyAddr }
func (s *AndroidSession) IsConnected() bool     { return s.Status() == StatusConnected }
func (s *AndroidSession) Resize(int, int) error { return nil }
func (s *AndroidSession) Write([]byte) error    { return nil }
func (s *AndroidSession) Connect(cfg ConnectionConfig) (err error) {
	source, options, err := androidVideoOptions(cfg.AndroidVideoSource)
	if err != nil {
		return err
	}
	s.videoSource = source
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
	key, err := androidPrivateKey()
	if err != nil {
		return err
	}
	s.client, err = adb.Dial(ctx, s.target, key, "uniterm")
	if err != nil {
		return fmt.Errorf("Android connection failed; authorize the device or pair wireless debugging first: %w", err)
	}
	s.stopClient = context.AfterFunc(s.ctx, func() { s.client.Close() })
	var b [16]byte
	if _, err = rand.Read(b[:]); err != nil {
		return err
	}
	s.token = hex.EncodeToString(b[:])
	scid := fmt.Sprintf("%08x", binary.BigEndian.Uint32(b[:4])&0x7fffffff)
	s.remoteJar = "/data/local/tmp/uniterm-" + s.token + ".jar"
	if err = s.push(ctx, s.remoteJar, bytes.NewReader(androidServer)); err != nil {
		return err
	}
	if source != "display" {
		sdk, e := s.exec(ctx, "getprop ro.build.version.sdk")
		if e != nil {
			return e
		}
		level, _ := strconv.Atoi(strings.TrimSpace(string(sdk)))
		if level < 31 {
			return fmt.Errorf("camera capture requires Android 12 or newer")
		}
		cameras, e := s.exec(ctx, "CLASSPATH="+s.remoteJar+" app_process / com.genymobile.scrcpy.Server 3.3.4 list_cameras=true cleanup=false")
		if e != nil {
			return e
		}
		if !strings.Contains(string(cameras), "("+source+",") {
			return fmt.Errorf("no accessible %s camera; select Screen to return", source)
		}
	}
	s.socket = "localabstract:scrcpy_" + scid
	command := "CLASSPATH=" + s.remoteJar + " app_process / com.genymobile.scrcpy.Server 3.3.4 scid=" + scid + " tunnel_forward=true audio=true audio_codec=raw video_codec=h264 video_codec_options=profile=1,level=2048 max_size=1280 max_fps=30 video_bit_rate=4000000 send_device_meta=false send_dummy_byte=true clipboard_autosync=false" + options
	s.process, err = androidOpen(s.ctx, s.client, "shell:"+command)
	if err != nil {
		return err
	}
	go io.Copy(io.Discard, s.process)
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
		if s.client != nil {
			// Clean a jar uploaded before startup failed, and bound cleanup even if the
			// peer stops consuming data. scrcpy also cleans its own jar on normal exit.
			ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
			stop := context.AfterFunc(ctx, func() { s.client.Close() })
			if s.remoteJar != "" {
				s.exec(ctx, "rm -f "+s.remoteJar)
			}
			stop()
			cancel()
		}
		if s.cancel != nil {
			s.cancel()
		}
		if s.client != nil {
			s.client.Close()
		}
		if s.stopClient != nil {
			s.stopClient()
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
		s.setStatus(StatusDisconnected)
	})
	return nil
}
func (s *AndroidSession) dial() (io.ReadWriteCloser, error) {
	var conn io.ReadWriteCloser
	var err error
	for i := 0; i < 60; i++ {
		ctx, cancel := context.WithTimeout(s.ctx, time.Second)
		conn, err = s.client.RawOpen(ctx, s.socket)
		cancel()
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
	var video io.ReadWriteCloser
	for attempt := 0; attempt < 100; attempt++ {
		video, err = s.dial()
		if err != nil {
			break
		}
		dummy := make([]byte, 1)
		err = androidReadFull(s.ctx, video, dummy, time.Second)
		if err == nil {
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
	if err = androidReadFull(s.ctx, video, header, 20*time.Second); err != nil {
		fail(err)
		return
	}
	meta, _ := json.Marshal(map[string]any{"width": binary.BigEndian.Uint32(header[4:8]), "height": binary.BigEndian.Uint32(header[8:12]), "codec": "h264", "videoSource": s.videoSource})
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
		if s.videoSource != "display" {
			continue
		} // Camera preview never injects display input.
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
func (s *AndroidSession) media(c io.Reader, channel byte, send func(int, []byte) error) error {
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
	stopRequest := context.AfterFunc(r.Context(), cancel)
	defer stopRequest()
	if r.URL.Query().Get("op") == "resolution" {
		if r.Method != "POST" {
			http.Error(w, "POST required", 405)
			return
		}
		if s.videoSource != "display" {
			http.Error(w, "screen resolution is unavailable in camera mode", 409)
			return
		}
		var request androidResolutionRequest
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1024)).Decode(&request); err != nil {
			http.Error(w, "invalid resolution", 400)
			return
		}
		if _, err := request.command(); err != nil {
			http.Error(w, err.Error(), 400)
			return
		}
		s.displayMu.Lock()
		defer s.displayMu.Unlock()
		ctx, stop := context.WithTimeout(ctx, 20*time.Second)
		defer stop()
		if err := applyAndroidResolution(request, func(command string) ([]byte, error) { return s.exec(ctx, command) }); err != nil {
			http.Error(w, err.Error(), 502)
			return
		}

		w.WriteHeader(http.StatusNoContent)
		return
	}
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
		stream, e := androidOpen(ctx, s.client, "shell:"+string(body))
		if e != nil {
			http.Error(w, e.Error(), 502)
			return
		}
		defer stream.Close()
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		io.Copy(w, io.LimitReader(stream, 1024*1024))
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
		_, e = f.Seek(0, io.SeekStart)
		if e != nil {
			http.Error(w, e.Error(), 500)
			return
		}
		if e = s.push(ctx, path, f); e != nil {
			http.Error(w, e.Error(), 502)
			return
		}
		w.WriteHeader(204)
	case "download":
		if r.Method != "GET" {
			http.Error(w, "GET required", 405)
			return
		}
		sizeText, e := s.exec(ctx, "stat -c %s "+androidQuote(path))
		size, parseErr := strconv.ParseInt(strings.TrimSpace(string(sizeText)), 10, 64)
		if e != nil || parseErr != nil {
			http.Error(w, "remote file not found or unreadable", 404)
			return
		}
		if size < 0 || size > 256*1024*1024 {
			http.Error(w, "maximum file size is 256 MiB", 413)
			return
		}
		stream, e := androidOpen(ctx, s.client, "exec:cat "+androidQuote(path))
		if e != nil {
			http.Error(w, e.Error(), 502)
			return
		}
		defer stream.Close()
		w.Header().Set("Content-Length", strconv.FormatInt(size, 10))
		w.Header().Set("Content-Type", "application/octet-stream")
		io.CopyN(w, stream, size)
	default:
		http.Error(w, "unknown operation", 400)
	}
}

func androidQuote(value string) string { return "'" + strings.ReplaceAll(value, "'", "'\\''") + "'" }

// Values are allowlisted before constructing the remote shell command.
func androidVideoOptions(source string) (string, string, error) {
	switch source {
	case "", "display":
		return "display", " video_source=display audio_source=output", nil
	case "front", "back":
		return source, " video_source=camera camera_facing=" + source + " camera_fps=30 audio_source=output", nil
	default:
		return "", "", fmt.Errorf("invalid Android video source")
	}
}

type androidResolutionRequest struct {
	Width  int  `json:"width"`
	Height int  `json:"height"`
	DPI    int  `json:"dpi"`
	Reset  bool `json:"reset"`
}

func (r androidResolutionRequest) command() (string, error) {
	if r.Reset {
		return "wm size reset && wm density reset", nil
	}
	if r.Width < 320 || r.Width > 4096 || r.Height < 320 || r.Height > 4096 {
		return "", fmt.Errorf("width and height must be between 320 and 4096")
	}
	if r.DPI != 0 && (r.DPI < 120 || r.DPI > 960) {
		return "", fmt.Errorf("DPI must be between 120 and 960")
	}
	command := fmt.Sprintf("wm size %dx%d", r.Width, r.Height)
	if r.DPI != 0 {
		command += fmt.Sprintf(" && wm density %d", r.DPI)
	}
	return command, nil
}
