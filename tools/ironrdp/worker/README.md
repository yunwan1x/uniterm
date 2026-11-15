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
# Set CHROMIUM_EXECUTABLE to reuse an installed Chromium if needed.
node tools/ironrdp/worker/render-check.mjs
```

Checks: exact RGBA quadrants/orientation in Canvas2D and WebGL2, resize,
texture reuse, preservation and orientation of separate damage patches, close after disposal, automatic software-GPU selection, real
key/delta AVC pictures in RGBA and YUV (using visible picture dimensions instead of decoder padding), two independent surface streams, reset and malformed
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

## Presentation pacing and damage

The protocol worker decodes every RDP delta in order. Its presentation queue
allows one unacknowledged snapshot, unions subsequent damage, and crops the
next snapshot to that union. Canvas2D draws at the damage origin; WebGL updates
only that texture rectangle. Initial and resized surfaces always send a full
snapshot. Display acknowledgements resume pending work immediately; document
RAF provides foreground pacing, without the old adaptive ACK-delay feedback.
Hidden documents retain a fixed 10fps cap to avoid an unpaced snapshot loop.
The display ACK is separate from the RDP GFX EndFrame acknowledgement.

`session.worker.test.ts` exercises the actual worker with a mocked protocol
adapter: initial surface, in-flight updates, immediate display ACK and resize.
The real-browser damage tests verify that separated updates retain untouched
pixels in all renderers. No screenshots or recordings are produced by these
checks. Temporary fixture pages and generated build files must be removed.

Canvas `data-rdp-stats` includes cumulative decode/wait, canvas write, snapshot
and ACK-wait times, snapshot pixels versus equivalent full desktop pixels,
and main-thread presentation draw/RAF-wait times. `frames` counts submitted
snapshots rather than physical monitor refreshes. These metrics locate work;
software-GPU headless results do not establish real-device hardware performance.

For a controlled real RDP comparison, copy `presentation-stress.html` to
`/tmp/uniterm-render-test.html` inside the dedicated `uniterm-linux-rdp`
container. Start baseline and candidate gateways sequentially on loopback
18085 with the corresponding fully built frontend embedded in each server.
Use the same private credentials file as above, then run:

```sh
node tools/ironrdp/worker/presentation-live.mjs baseline
# Switch the isolated gateway to the candidate server, keeping credentials.
node tools/ironrdp/worker/presentation-live.mjs candidate
```

The driver uses the latest logged-in linuxrdp display, starts an owned Chromium
profile, warms up for 9 seconds and samples 12 seconds of 4K animation/scrolling
and tone playback. It terminates only its owned source browser and closes its
test client. Remove its `/tmp/uniterm-render-test-profile` and fixture afterward.
This is a controlled Linux workload, not the Windows YouTube reproduction.
Both test frontends must use the same browser/GPU and isolation headers. Do not
substitute static assets in place of a complete baseline service. Check actual
AVC counters and dimensions; an idle or wrong desktop is not a passing test.
Output contains metrics only, with no screenshots or recordings. Remove the
temporary report directory after retaining at most the current concise result.
