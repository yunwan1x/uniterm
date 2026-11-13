package session

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/pem"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sync"
	"time"

	adb "github.com/juanlianyangyang/adb-go/adb"
)

// adb-go logs pairing codes at info level. Disable its global logger once,
// before any connection; callers return contextual errors without credentials.
func init() { adb.SetLogger(adb.NewDefaultLogger(io.Discard, "", 0)) }

var androidKeyMu sync.Mutex

// Keep the existing worker-local ADB identity across upgrades. Never use the
// library's embedded/default key loader or another worker's shared ADB daemon.
func androidPrivateKey() (*rsa.PrivateKey, error) {
	androidKeyMu.Lock()
	defer androidKeyMu.Unlock()
	home, err := os.UserHomeDir()
	if err != nil {
		return nil, err
	}
	dir := filepath.Join(home, ".android")
	if err = os.MkdirAll(dir, 0700); err != nil {
		return nil, err
	}
	path := filepath.Join(dir, "adbkey")
	data, err := os.ReadFile(path)
	if err == nil {
		block, _ := pem.Decode(data)
		if block == nil {
			return nil, fmt.Errorf("invalid Android private key")
		}
		key, e := x509.ParsePKCS1PrivateKey(block.Bytes)
		if e != nil {
			parsed, pe := x509.ParsePKCS8PrivateKey(block.Bytes)
			if pe != nil {
				return nil, fmt.Errorf("invalid Android private key: %w", pe)
			}
			var ok bool
			key, ok = parsed.(*rsa.PrivateKey)
			if !ok {
				return nil, fmt.Errorf("Android private key must be RSA")
			}
		}
		if err = key.Validate(); err != nil {
			return nil, err
		}
		return key, nil
	}
	if !os.IsNotExist(err) {
		return nil, err
	}
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		return nil, err
	}
	f, err := os.CreateTemp(dir, ".adbkey-*")
	if err != nil {
		return nil, err
	}
	defer os.Remove(f.Name())
	data = pem.EncodeToMemory(&pem.Block{Type: "RSA PRIVATE KEY", Bytes: x509.MarshalPKCS1PrivateKey(key)})
	if _, err = f.Write(data); err != nil {
		f.Close()
		return nil, err
	}
	if err = f.Close(); err != nil {
		return nil, err
	}
	if err = os.Rename(f.Name(), path); err != nil {
		return nil, err
	}
	return key, nil
}

// Contexts in adb-go govern opening a stream, not its subsequent I/O.
// Bind stream lifetime to the HTTP request/session too.
type androidStream struct {
	io.ReadWriteCloser
	raw  *adb.Stream
	stop func() bool
	once sync.Once
}

func (s *androidStream) Close() error {
	var err error
	s.once.Do(func() { s.stop(); err = s.ReadWriteCloser.Close() })
	return err
}
func androidOpen(ctx context.Context, client *adb.Client, service string) (*androidStream, error) {
	stream, err := client.RawOpen(ctx, service)
	if err != nil {
		return nil, err
	}
	stop := context.AfterFunc(ctx, func() { stream.Close() })
	return &androidStream{ReadWriteCloser: stream, raw: stream, stop: stop}, nil
}
func androidReadFull(ctx context.Context, stream io.ReadWriteCloser, data []byte, timeout time.Duration) error {
	deadline, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	stop := context.AfterFunc(deadline, func() { stream.Close() })
	defer stop()
	_, err := io.ReadFull(stream, data)
	if deadline.Err() != nil {
		return deadline.Err()
	}
	return err
}
func (s *AndroidSession) exec(ctx context.Context, command string) ([]byte, error) {
	stream, err := androidOpen(ctx, s.client, "exec:"+command)
	if err != nil {
		return nil, err
	}
	defer stream.Close()
	data, err := io.ReadAll(io.LimitReader(stream, 1024*1024))
	if ctx.Err() != nil {
		return nil, ctx.Err()
	}
	return data, err
}
func (s *AndroidSession) push(ctx context.Context, path string, reader io.Reader) error {
	stream, err := androidOpen(ctx, s.client, "sync:")
	if err != nil {
		return err
	}
	defer stream.Close()
	syncClient := adb.NewSyncClient(stream.raw)
	err = syncClient.Send(path, 0644, uint32(time.Now().Unix()), reader)
	if ctx.Err() != nil {
		return ctx.Err()
	}
	return err
}
