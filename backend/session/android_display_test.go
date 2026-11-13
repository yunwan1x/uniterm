package session

import (
	"fmt"
	"strings"
	"testing"
)

func TestAndroidDisplayApplyAndRollback(t *testing.T) {
	for _, failure := range []string{"", "density-denied", "silently-ignored"} {
		t.Run(failure, func(t *testing.T) {
			size, density := "900x1600", "400"
			injectFailure := true
			run := func(command string) ([]byte, error) {
				if command == "wm size" {
					return []byte("Physical size: 720x1280\nOverride size: " + size + "\n"), nil
				}
				if command == "wm density" {
					return []byte("Physical density: 320\nOverride density: " + density + "\n"), nil
				}
				for _, part := range strings.Split(command, " && ") {
					fields := strings.Fields(part)
					if len(fields) != 3 {
						return nil, fmt.Errorf("unexpected command %q", command)
					}
					if fields[1] == "size" {
						size = fields[2]
					} else {
						if injectFailure && failure != "" {
							injectFailure = false
							if failure == "density-denied" {
								return []byte("Error: permission denied"), nil
							}
							return nil, nil
						}
						density = fields[2]
					}
				}
				return nil, nil
			}
			err := applyAndroidResolution(androidResolutionRequest{Width: 1206, Height: 2622, DPI: 480}, run)
			if failure == "" {
				if err != nil || size != "1206x2622" || density != "480" {
					t.Fatalf("%s %s %v", size, density, err)
				}
			} else if err == nil || size != "900x1600" || density != "400" {
				t.Fatalf("did not restore %s %s %v", size, density, err)
			}
		})
	}
}

func TestAndroidDisplayResetBoth(t *testing.T) {
	size, density := "1206x2622", "480"
	run := func(command string) ([]byte, error) {
		switch command {
		case "wm size":
			output := "Physical size: 720x1280\n"
			if size != "" {
				output += "Override size: " + size + "\n"
			}
			return []byte(output), nil
		case "wm density":
			output := "Physical density: 320\n"
			if density != "" {
				output += "Override density: " + density + "\n"
			}
			return []byte(output), nil
		case "wm size reset && wm density reset":
			size = ""
			density = ""
			return nil, nil
		default:
			return nil, fmt.Errorf("unexpected %q", command)
		}
	}
	if err := applyAndroidResolution(androidResolutionRequest{Reset: true}, run); err != nil {
		t.Fatal(err)
	}
	if size != "" || density != "" {
		t.Fatal("overrides remain")
	}
}
