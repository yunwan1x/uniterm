# RDP command scheduling and GPU snapshot follow-up

The deployed `d3855519` client still inserted a zero-delay browser timer before
each deferred graphics command. Nested browser timers can be clamped to roughly
4 ms: the hardware Edge probe took about 394 ms for 100 nested zero-delay timers.
A completed RDP frame often contains several ordered commands, so this delay is
paid repeatedly even when decoding has finished and the network is idle.

## Changes in 5e616c15 / uniterm.15

- Poll buffered network/audio first, then process a ready graphics command in
  the same poll if the network is pending. No timer is created per command.
  A 4 ms / 32-PDU receive budget and existing queue high-water marks force
  graphics progress under continuous traffic. The session still yields after
  8 ms of processing, now also after 64 events on coarse clocks.
- Keep the async decode future, ordered graphics queue and actual EndFrame ACK
  semantics. Encoded reference pictures and drawing commands are not discarded.
- Copy the returned WebCodecs typed-array view directly into owned WASM memory,
  removing an intermediate JavaScript typed-array clone for both RGBA and YUV.
- Transfer completed GPU output with `transferToImageBitmap()` as a full frame.
  Persistent GPU surface textures remain authoritative and redraw subsequent
  outputs. Canvas2D retains its incremental framebuffer and cropped snapshots.
  One in-flight bitmap and the existing hidden-document limit remain in place.

The combined IronRDP patch and vendored tarball are pinned together at
`0.5.1-uniterm.15`. The tarball SHA256 is
`a034cb5342d13fcffa297adca90ba016880109d214a9794ee1c1c4b7a5bfe267`.

## Validation and limits

- 42 native-compatible web tests passed; 29 browser-only clipboard tests were
  excluded. All 72 EGFX tests and 43 frontend RDP/audio tests passed.
- Worker/client TypeScript checking, production WASM/Vite/Go builds, ARM64
  cross-compilation and `upx -t` passed.
- The combined patch applies to pinned IronRDP
  `905c28b3a4e67b15fac274c5d808ef3cef0eb813`.
- The Intel UHD hardware browser check verifies that transferring an output
  retains later patches and untouched pixels through the persistent surfaces,
  including output resize. The regression script is
  `tools/ironrdp/worker/gpu-compositor-check.mjs`.

Live probes use a disposable Linux xrdp 0.10.6.1 desktop at 3840x2160, the
controlled `tools/ironrdp/worker/presentation-stress.html` animation/scroll/tone,
and Windows 11 Edge with Intel UHD rendering. Source animation runs at roughly
46 FPS. Each comparison restarts only the owned container, waits for the xrdp
audio sink, clears the owned source-browser profile, warms up and then samples
for approximately 12 seconds. The restore-session dialog must be dismissed
before input or visible-canvas acceptance.

These measurements count canvas draw submissions, not physical monitor refreshes
or unique video pictures. One-second worker stats may lag the draw observations.
Linux-source AVC420 acceptance does not replace a Windows-server AVC444 test.
The earlier Windows results and limitations remain in
`rdp-async-gpu-surfaces-20261115.md`.

| Visible 4K probe | Draw submissions/s | p95 gap | Maximum gap | New audio underruns |
|---|---:|---:|---:|---:|
| NAS baseline `d3855519` | 6.94 | 191 ms | 674 ms | 0 |
| NAS candidate `5e616c15` | 9.09 | 143 ms | 652 ms | 1 |
| Router candidate, isolated HTTPS listener | 9.52 | 148 ms | 197 ms | 0 |

The matched NAS comparison improves throughput by about 31% and typical pacing,
but its long stall and one audio underrun remain. The router round verifies
real AVC420 GPU draws, nonzero PCM, zero new audio underruns/overflows, and an F8
key arriving in the remote source browser. It is an acceptance round, not a
matched router baseline comparison. This follow-up does not establish 60 FPS or
complete elimination of 4K frame drops. Raw numeric observations are retained in
`tools/ironrdp/results/rdp-pacing-20261115.json`.

An experimental worker-owned visible OffscreenCanvas eliminated snapshot and
bitmap-ACK time, but the final visible-canvas trial still submitted only about
6.69 frames/s with 649 ms maximum gaps. It is not shipped. Its EndFrame counts
are not directly comparable with main-canvas draw counts. Earlier trials behind
a restore dialog and a native-client probe without a verified changing source
are excluded from the acceptance table.

## Router artifact

The server embeds the tested frontend. The gateway, account data and TLS files
are unchanged. The package reuses the previous release's gateway and installer.

- Code commit: `5e616c15`.
- Archive: `uniterm-0.3.0-rc.4-5e616c15-arm64.tar.gz` (15,558,206 bytes).
- Archive SHA256: `831ee4c82a5a58749c52ba692628757f334ff4df5557606603df9ea1058b0b49`.
- Server SHA256: `cfe62ddbb54ea879b420a77d6aa6b5fb7570ed9c175e0345a9a46833aece7e21`.
- Gateway SHA256: `22d3c4d6c805d92661f9b2b1ac7945e9e28f0478174f74928d324a4684c596a5`.

The previous `uniterm-0.3.0-rc.3-d3855519-arm64.tar.gz` archive is retained on the
NAS for rollback. No second server backup is written to the router's limited
flash. The installed server is replaced only after isolated-port acceptance.

Delivery passed on `https://192.168.50.1:18888`: the service restarted, its health
endpoint returned OK, and both installed hashes matched the values above. Existing
browser tabs must reload and reconnect to receive the new worker and WASM.
