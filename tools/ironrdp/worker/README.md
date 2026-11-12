# Worker / AVC / renderer regression

These tests use a dedicated Linux xrdp desktop and an isolated uniTerm gateway.
Do not point fault injection at a production browser session.

The live setup uses xrdp 0.10.6.1 built with `--enable-rfxcodec --enable-x264`,
xorgxrdp 0.10.4, and the image gallery from `../live/`. The test gateway is at
localhost:18085; the unchanged baseline is at localhost:18086. The RDP server
is at 172.17.0.1:13390, with the existing isolated 20 Mbps limiter on :13391.
Remote Chrome CDP listens only on localhost:19226. These local defaults can be
edited for a different test installation; they are not deployment settings.
Credentials are read from `RDP_CREDENTIALS_FILE` (JSON containing `username`,
`password`, `adminPassword`) and must never be committed.

Set `PLAYWRIGHT_MODULE` when Playwright is not installed in this repository.
Set `RDP_ARTIFACT_DIR` to an existing writable evidence directory.

## Renderer and real WebCodecs pictures

Copy `render.html` to `frontend/rdp-render-test.html`, start Vite on port 34116,
and remove the temporary page after the test. Generate the H.264 fixture:

```sh
ffmpeg -y -f lavfi -i 'testsrc=size=64x64:rate=10' -frames:v 5 \
  -c:v libx264 -pix_fmt yuv420p -tune zerolatency -x264-params aud=1 \
  -f h264 /tmp/uniterm-worker-test.h264
node tools/ironrdp/worker/render-check.mjs
```

Checks: exact RGBA quadrants/orientation in Canvas2D and WebGL2, resize,
texture reuse, close after disposal, automatic software-GPU selection, real
key/delta AVC pictures, two independent surface streams, reset and malformed
input rejection. Readback occurs inside the draw call for correctness only;
the timing loop does not perform GPU readbacks. Timing includes RAF waiting
and is not an isolated GPU execution benchmark.

## Actual application

`compare.mjs LABEL` follows `../live/compare.mjs` but measures either the old
main-thread `putImageData` path or the new document `drawImage` path. Both use
GFX; the baseline is not legacy tiled RDP. Worker byte counters are sampled
before/after the measurement. `RDP_NO_ISOLATION=1` strips isolation headers in
the **test browser**, exercising automatic non-AVC fallback. Use
`UNITERM_TEST_URL`, `REMOTE_BROWSER_CDP`, `RDP_CREDENTIALS_FILE`, and
`RDP_ARTIFACT_DIR`. Run cases sequentially against the same desktop.

`live-regression.mjs` forces the software WebGL renderer for functional
verification, checks keyboard input and the floating keyboard, blocks the main
thread while the remote scrolls, asserts at most one unacknowledged snapshot,
loses the GL context, and checks automatic Canvas recovery and resize/zoom.
This does not claim hardware-GPU performance.

`fallback-check.mjs` replaces only the test browser's AVC worker or protocol
worker script. It asserts automatic recovery after an AVC failure and after a
worker startup failure, without manual mode selection.

Gateway isolation headers make WebCodecs shared memory available over HTTPS or
localhost. In insecure/non-isolated contexts the protocol worker still works
but does not advertise AVC. No isolation/security bypass is used in these tests.
