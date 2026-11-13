package session

import (
	"encoding/binary"
	"fmt"
	"io"
)

// scrcpy device messages, plus the pinned uniTerm type-100 extension.
func androidDeviceMessages(r io.Reader, bitrate func(int32)) error {
	for {
		var kind [1]byte
		if _, err := io.ReadFull(r, kind[:]); err != nil {
			return err
		}
		var length uint32
		switch kind[0] {
		case 100:
			var value int32
			if err := binary.Read(r, binary.BigEndian, &value); err != nil {
				return err
			}
			if value == 0 || value > 40000000 || value < -40000000 {
				return fmt.Errorf("invalid bitrate acknowledgement")
			}
			bitrate(value)
			continue
		case 0:
			if err := binary.Read(r, binary.BigEndian, &length); err != nil {
				return err
			}
		case 1:
			length = 8
		case 2:
			var header [4]byte
			if _, err := io.ReadFull(r, header[:]); err != nil {
				return err
			}
			length = uint32(binary.BigEndian.Uint16(header[2:]))
		default:
			return fmt.Errorf("unknown Android device message %d", kind[0])
		}
		if length > 256*1024 {
			return fmt.Errorf("oversized Android device message")
		}
		if _, err := io.CopyN(io.Discard, r, int64(length)); err != nil {
			return err
		}
	}
}
