package session

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"image"
	_ "image/jpeg"
	_ "image/png"
	"io"
	"net/http"
	"os"
	"time"
)

const androidPasteLimit = 128 * 1024
const androidImageLimit = 16 * 1024 * 1024

func (s *AndroidSession) clipboardImage(ctx context.Context, w http.ResponseWriter, r *http.Request) {
	if r.Method != "POST" {
		w.Header().Set("Allow", "POST")
		http.Error(w, "POST required", 405)
		return
	}
	if s.videoSource != "display" {
		http.Error(w, "screen input required", 409)
		return
	}
	if !s.imageMu.TryLock() {
		http.Error(w, "image transfer in progress", 409)
		return
	}
	defer s.imageMu.Unlock()
	f, err := os.CreateTemp("", "uniterm-clipboard-*")
	if err != nil {
		http.Error(w, "temporary storage unavailable", 500)
		return
	}
	defer os.Remove(f.Name())
	defer f.Close()
	if _, err = io.Copy(f, http.MaxBytesReader(w, r.Body, androidImageLimit)); err != nil {
		var limit *http.MaxBytesError
		if errors.As(err, &limit) {
			http.Error(w, "image exceeds 16 MiB", 413)
		} else {
			http.Error(w, "image transfer incomplete", 400)
		}
		return
	}
	if _, err = f.Seek(0, 0); err != nil {
		http.Error(w, "temporary storage unavailable", 500)
		return
	}
	cfg, format, err := image.DecodeConfig(f)
	if err != nil || (format != "png" && format != "jpeg") || cfg.Width <= 0 || cfg.Height <= 0 || int64(cfg.Width)*int64(cfg.Height) > 32*1024*1024 {
		http.Error(w, "expected a PNG or JPEG image up to 32 megapixels", 415)
		return
	}
	if _, err = f.Seek(0, 0); err != nil {
		http.Error(w, "temporary storage unavailable", 500)
		return
	}
	var nonce [16]byte
	if _, err = rand.Read(nonce[:]); err != nil {
		http.Error(w, "temporary name unavailable", 500)
		return
	}
	path := "/data/local/tmp/uniterm-clip-" + hex.EncodeToString(nonce[:])
	// scrcpy unlinks the projection jar at startup. Stage the image entry point
	// separately for this request so normal scrcpy cleanup remains enabled.
	jar := path + ".jar"
	defer func() {
		clean, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		s.exec(clean, "rm -f "+path+" "+jar)
	}()
	if err = s.pushMode(ctx, path, f, 0600); err != nil {
		http.Error(w, "device upload failed", 502)
		return
	}
	if err = s.pushMode(ctx, jar, bytes.NewReader(androidServer), 0400); err != nil {
		http.Error(w, "clipboard component upload failed", 502)
		return
	}
	out, err := s.exec(ctx, "CLASSPATH="+jar+" app_process / org.uniterm.clipboard.ClipboardImage "+path+" image/"+format)
	if err != nil || !bytes.Equal(bytes.TrimSpace(out), []byte("UNITERM_CLIPBOARD_OK")) {
		http.Error(w, "device clipboard unavailable (Android 10 or newer required)", 502)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
