package session

import "fmt"

// AndroidVideoQuality controls encoding only, never the device display or DPI.
type AndroidVideoQuality struct {
	MaxSize int `json:"maxSize"`
	MaxFPS  int `json:"maxFps"`
	Bitrate int `json:"bitrate"`
}

func androidQualityOptions(q *AndroidVideoQuality) (string, error) {
	if q == nil {
		q = &AndroidVideoQuality{1280, 30, 4000000}
	}
	if (q.MaxSize != 0 && (q.MaxSize < 320 || q.MaxSize > 4096)) || q.MaxFPS < 1 || q.MaxFPS > 60 || q.Bitrate < 500000 || q.Bitrate > 40000000 {
		return "", fmt.Errorf("invalid Android video quality: size 0 or 320–4096, FPS 1–60, bitrate 500000–40000000")
	}
	return fmt.Sprintf(" max_size=%d max_fps=%d video_bit_rate=%d", q.MaxSize, q.MaxFPS, q.Bitrate), nil
}
