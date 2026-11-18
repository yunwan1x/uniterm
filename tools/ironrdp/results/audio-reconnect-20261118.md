# Audio after resolution reconnect

## Change

Package `0.5.2-uniterm.21` discards Wave, Wave2 and Close received before Training
without entering Stop. Split pre-v8 Wave payloads are consumed as raw data;
concatenated WaveInfo/data does not consume the following Training message.
No frontend playback or resolution-switch logic changes are required.

The combined patch retains the pinned IronRDP base and previous UniTerm changes.
It includes four regression tests and a standalone RDPSND test target.

## Verification

- The new early-audio regression fails before the fix: Training produces no response.
- `cargo +stable test --locked -p ironrdp-testsuite-core --test rdpsnd_regression`:
  160 passed, including the four new regressions.
- `cargo +stable test --locked -p ironrdp-web --lib -- --skip clipboard::tests`:
  42 passed, 29 filtered (browser-only clipboard tests).
- Release WASM build, wasm-bindgen 0.2.129, npm package, frontend build and
  CGO-disabled production/server Go build succeeded.
- Reapplying the combined patch to a clean pinned checkout reproduced the build sources.

The full core integration suite currently fails to compile because four existing
ActiveStageBuilder fixtures omit the `security` field added by the previous
Standard RDP Security patch. This change does not modify those fixtures; the
standalone target runs the entire RDPSND suite without them.

## Live reproduction

Headless Chromium used UniTerm's actual resolution selector, user-gesture audio
activation and AudioWorklet playback. A continuous 44.1 kHz stereo PCM tone played
on a separate test desktop. A loopback proxy added 150 ms delay each direction
(300 ms RTT); resolutions alternated between 1920x1080 and 1280x720, sampled
6.5 seconds after each change. xrdp was 0.10.6.1 with the original, unpatched
audio channel server, using the production build configuration.

The existing production user's channel server kept its compatibility patch;
only the test account ran the unpatched channel server.

Baseline package uniterm.20 packet counts (initial, then four switches):
`[68, 62, 0, 0, 0]`, with 222 Invalid PDU/Stop errors.

Fixed package uniterm.21 before the latest frontend merge (eight switches):
`[70, 60, 56, 51, 60, 60, 58, 61, 60]`, with no Invalid PDU/Stop errors.

Browser counters verify PCM delivery and a running playback context, not a human
listening to physical speakers. Resolution changes reconnect the session, so a
brief playback interruption during reconnect remains expected.

After merging origin/main `b172ba3e`, rebuilding frontend and Go worker, the same
eight-switch test passed again: `[70, 62, 61, 63, 61, 63, 62, 63, 61]`; no Invalid PDU, Stop, or page errors.
