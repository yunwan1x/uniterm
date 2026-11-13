package session

import (
	"strings"
	"testing"
)

func TestAndroidQualityOptions(t *testing.T) {
	for _, size := range []int{0, 1280, 1920, 2560} {
		s, err := androidQualityOptions(&AndroidVideoQuality{size, 60, 8000000})
		if err != nil || !strings.Contains(s, "max_fps=60") {
			t.Fatalf("size %d: %s %v", size, s, err)
		}
		if size == 0 && !strings.Contains(s, "max_size=0") {
			t.Fatal("native must not retain a size cap")
		}
	}
	for _, q := range []AndroidVideoQuality{{-1, 30, 4000000}, {4097, 30, 4000000}, {1280, 0, 4000000}, {1280, 61, 4000000}, {1280, 30, 0}} {
		if _, err := androidQualityOptions(&q); err == nil {
			t.Fatalf("accepted invalid quality %+v", q)
		}
	}
	if s, err := androidQualityOptions(nil); err != nil || !strings.Contains(s, "max_size=1280") {
		t.Fatal("legacy defaults changed")
	}
}
