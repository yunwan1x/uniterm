# Android quality presets and adaptive bitrate

The video quality panel offers Auto, Balanced, High fidelity and Custom. Only
Custom exposes the longest edge, frame-rate and bitrate controls. Old saved
settings migrate to Custom; selection and custom parameters persist per host/port.

| Preset | Longest edge | FPS | Target bitrate |
|---|---|---|---|
| Auto (new default) | Fit viewport at connection, 640–1920 px | 30 | Start 8 Mbps; adapt 2–40 Mbps |
| Balanced | 1920 px | 30 | 8 Mbps |
| High fidelity | Native, subject to device encoder limits | 60 | 40 Mbps |
| Custom | Fit/1280/1920/2560/native | 15/30/60 | 2/4/8/12/20/30/40 Mbps |

Applying a preset reconnects. Subsequent automatic bitrate changes keep the same
WebSocket, capture, canvas and decoder. No device resolution/DPI changes occur.
Auto does not dynamically change resolution or FPS. High fidelity is lossy H.264,
not lossless.

Every two seconds the browser samples relative PTS delivery delay, ping RTT growth,
queued decoder bytes and decoder write duration. Two congested samples lower the
bitrate; ten healthy moving-video samples permit one upward step. Six seconds
minimum between changes prevents oscillation. Static or hidden views do not drive
upward probing. The initial/minimum PTS offset removes the device/browser clock
offset; this is queue-growth detection, not synchronized one-way latency.

The private type-100 scrcpy extension uses MediaCodec.setParameters while keeping
the encoder alive and acknowledges acceptance/rejection. See androidassets/README.md
for the pinned source, patch, protocol and build instructions. The Go backend
validates the bitrate range, consumes complete device-message frames, and forwards
acknowledgements. The browser changes the displayed target after an ACK, pauses
on ACK timeout (late ACK resumes it), and reports unsupported/rejected changes
without breaking the session. Codec acceptance does not guarantee exact output
bitrate; actual bandwidth depends on content and encoder implementation. The
minimum video target plus raw audio and protocol overhead may exceed very slow
links. H.264 references are never dropped arbitrarily to clear a backlog.

## Validation — 2026-11-13

- Production frontend and Go server build passed.
- 21 frontend quality/client tests passed, including preset mapping, saved-setting
  migration, congestion/decoder backpressure, cooldown, slow growth, static screens,
  acknowledgement handling, unsupported servers and encoder rejection.
- All TestAndroid backend tests passed, including message framing/bounds.
- Existing repository typecheck: 570 errors, none in changed Android modules.
- Live Chromium + redroid + real patched server: animated WebView source; normal
  stream transferred 14,482,878 bytes during a 22-second sample and target rose
  from 8 to 12 Mbps. A TCP relay limited downstream to 250,000 B/s; the controller
  requested 4 then 2 Mbps, both acknowledged by Android. No stream reconnection
  and no browser page errors. This proves runtime adjustment and congestion
  response, not a guaranteed achievable rate or smoothness on every device.
- Live preset application: Balanced acknowledged initial 8 Mbps; High fidelity
  initial 40 Mbps, received framebuffer 1176x2560 on this redroid. Both selections
  persisted. Custom controls appear only when selected.
- Native phone hardware encoders, camera auto mode, and very long sessions were
  not exercised in this run.

Evidence in the parent workspace: artifacts/android-adaptive-20261113.
