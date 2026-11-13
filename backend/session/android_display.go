package session

import (
	"fmt"
	"regexp"
	"strings"
)

type androidDisplayState struct {
	size, density                 string
	sizeOverride, densityOverride string
}

func readAndroidDisplay(run func(string) ([]byte, error)) (androidDisplayState, error) {
	var state androidDisplayState
	for _, field := range []string{"size", "density"} {
		output, err := run("wm " + field)
		if err != nil {
			return state, err
		}
		pattern := "[0-9]+"
		if field == "size" {
			pattern = "[0-9]+x[0-9]+"
		}
		physical := regexp.MustCompile(`(?m)^Physical ` + field + `: (` + pattern + `)\r?$`).FindSubmatch(output)
		override := regexp.MustCompile(`(?m)^Override ` + field + `: (` + pattern + `)\r?$`).FindSubmatch(output)
		if len(physical) != 2 {
			return state, fmt.Errorf("cannot read Android %s", field)
		}
		value, forced := string(physical[1]), ""
		if len(override) == 2 {
			value = string(override[1])
			forced = value
		}
		if field == "size" {
			state.size = value
			state.sizeOverride = forced
		} else {
			state.density = value
			state.densityOverride = forced
		}
	}
	return state, nil
}

// Verify both values rather than trusting shell-v1's lack of exit status. If a
// device refuses a setting, restore the previous overrides where possible.
func applyAndroidResolution(request androidResolutionRequest, run func(string) ([]byte, error)) (err error) {
	command, err := request.command()
	if err != nil {
		return err
	}
	before, err := readAndroidDisplay(run)
	if err != nil {
		return err
	}
	defer func() {
		if err == nil {
			return
		}
		restore := func(field, value string) error {
			if value == "" {
				value = "reset"
			}
			output, e := run("wm " + field + " " + value)
			if e != nil {
				return e
			}
			if strings.TrimSpace(string(output)) != "" {
				return fmt.Errorf("%s", strings.TrimSpace(string(output)))
			}
			return nil
		}
		sizeErr := restore("size", before.sizeOverride)
		densityErr := restore("density", before.densityOverride)
		restored, verifyErr := readAndroidDisplay(run)
		if sizeErr != nil || densityErr != nil || verifyErr != nil || restored != before {
			err = fmt.Errorf("%w; could not verify restoration (size: %v, DPI: %v, readback: %v); use Device default to recover", err, sizeErr, densityErr, verifyErr)
		} else {
			err = fmt.Errorf("%w; previous display settings restored", err)
		}
	}()
	output, err := run(command)
	if err != nil {
		return err
	}
	if strings.TrimSpace(string(output)) != "" {
		return fmt.Errorf("Android display update: %s", strings.TrimSpace(string(output)))
	}
	after, err := readAndroidDisplay(run)
	if err != nil {
		return err
	}
	if request.Reset {
		if after.sizeOverride != "" || after.densityOverride != "" {
			return fmt.Errorf("Android did not restore default size and DPI")
		}
	} else {
		density := before.density
		if request.DPI != 0 {
			density = fmt.Sprint(request.DPI)
		}
		if after.size != fmt.Sprintf("%dx%d", request.Width, request.Height) || after.density != density {
			return fmt.Errorf("Android did not apply requested size and DPI (actual %s, %s DPI)", after.size, after.density)
		}
	}
	return nil
}
