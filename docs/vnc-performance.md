# Automatic VNC quality

VNC connections automatically adjust JPEG quality using noVNC's existing
`qualityLevel` negotiation. There is no mode selector. Compression remains at
noVNC's default level; increasing compression indiscriminately can make the
remote encoder CPU-bound.

The adapter is pinned to the project's noVNC 1.7.0 private update interfaces:

- Measure a FramebufferUpdate from its first received fragment through the
  existing display flush. This includes network wait and asynchronous decode;
  it is **not** input-to-display latency or decoder CPU time.
- Consider updates containing at least one quarter of the framebuffer's pixel
  area. Cursor/tiny-region updates must not imply that a congested link recovered.
- At 180 ms or more, decrease quality by one, at most once per 1.5 seconds.
  Keep a floor of 3 and ceiling of 6 (the previous noVNC default).
- After eight consecutive eligible updates under 80 ms, allow one upward step,
  no sooner than eight seconds after the previous change. Idle time alone does
  not raise quality or trigger an expensive full refresh.
- Ignore observations completed while the browser document is hidden.
- Preserve every RFB rectangle and noVNC's existing decode/paint ordering.
  Do not drop bytes from the TCP/WebSocket stream or discard dependent updates.
- Dispose observers and timers on disconnect, component unmount and reconnect;
  reinstall when a cached RFB is restored.

For profiling, the visible canvas emits `uniterm:vnc-performance` once a second.
It bubbles and contains cumulative received bytes, completed update count,
last update duration, synchronous update-processing time, and requested quality.
It contains no framebuffer pixels, credentials or network payloads. Requested
quality is not a guarantee that a particular VNC server honors the setting.

## Validation

Run the VNC utility suite from `frontend`:

```sh
npx vitest run src/utils/vncPerformance.test.ts src/utils/vncScaling.test.ts \
  src/utils/vncDisplays.test.ts src/utils/vncKeyboard.test.ts \
  src/utils/vncClipboard.test.ts src/utils/vncCursor.test.ts
npm run build
```

Compare the same desktop, server, browser and bandwidth in separate sessions.
Measure both first new-picture latency and the time until subsequent picture
updates stop. Include actual wheel input, a rapid-input burst, reconnect and
cached-tab restoration. Use unique visual sequence IDs throughout the burst:
repeated colors can falsely identify an old frame as the final frame.

Lower JPEG quality trades image fidelity for responsiveness. This client-side
policy cannot eliminate a server's background refreshes, change its frame-rate
limit, or turn a standard RFB server into a video encoder. Tests should not
describe initial-picture improvement as elimination of all subsequent repainting.

## X11 / Xpra evaluation

The existing X11 connection still forwards X11 over SSH to a local X server.
It is unchanged by this VNC policy. Xpra is a separate remote-display service,
not a codec that can be added to the raw SSH byte bridge.

An isolated prototype used Xpra's desktop server and HTML5 client with the
same image gallery. Automatic encoding and explicit JPEG were measured
separately, including a 20 Mbps link with 40 ms simulated round-trip latency.
The environment's packaged Xpra 3.0.6 and compatible HTML5 v4.1 are old versions;
these measurements establish feasibility, not performance guarantees for a
current release. Modern versions need a matching HTML5 client and a new
compatibility/security validation before product integration.

A production integration would require:

1. Xpra on the remote Linux host, with authenticated session startup/lifecycle.
2. A matching HTML5 client and an authenticated, tenant-isolated WebSocket route
   in the gateway (or a properly authenticated HTTPS endpoint).
3. Session resize, keyboard, clipboard, reconnect and browser codec validation.
4. Per-workload encoding policy: JPEG was tested for photographs, not established
   as the best setting for all text, video, 3D, or lossless-image workloads.

The prototype is not exposed as a new uniTerm connection type. No unauthenticated
Xpra listener is intended for deployment; benchmark listeners bind to loopback.

References:

- https://novnc.com/noVNC/docs/API.html
- https://tigervnc.org/doc/Xvnc.html
- https://github.com/TurboVNC/turbovnc/blob/main/doc/performance.txt
- https://xpra-org.github.io/xpra/Subsystems/Encoding.html
- https://github.com/Xpra-org/xpra-html5
