package session

import (
	"bytes"
	"encoding/binary"
	"io"
	"testing"
)

func TestAndroidDeviceBitrateMessages(t *testing.T) {
	var b bytes.Buffer
	b.Write([]byte{0, 0, 0, 0, 3, 100, 0, 0}) // Clipboard bytes must not be interpreted as an ack.
	b.WriteByte(100)
	binary.Write(&b, binary.BigEndian, int32(4000000))
	b.WriteByte(100)
	binary.Write(&b, binary.BigEndian, int32(-8000000))
	var got []int32
	err := androidDeviceMessages(&b, func(v int32) { got = append(got, v) })
	if err != io.EOF || len(got) != 2 || got[0] != 4000000 || got[1] != -8000000 {
		t.Fatalf("%v %v", got, err)
	}
}
func TestAndroidDeviceMessageBounds(t *testing.T) {
	for _, data := range [][]byte{{0, 255, 255, 255, 255}, {100, 0}, {99}, {100, 127, 255, 255, 255}} {
		if androidDeviceMessages(bytes.NewReader(data), func(int32) { t.Fatal("invalid ack") }) == nil {
			t.Fatal("accepted invalid frame")
		}
	}
}
