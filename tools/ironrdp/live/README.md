# Real desktop regression scenario

Use a dedicated desktop account and an isolated uniTerm test container. Do not
reuse production credentials or change an existing xrdp service's configuration.

The verified setup uses XFCE, Xorg, xrdp 0.10.6.1 (RFX codec enabled), xorgxrdp
0.10.4, and a headed Chromium inside the RDP desktop. Put four local JPEG photos
next to `gallery.html` as `photo0.jpg` ... `photo3.jpg`; preload them before timing.
The test used Ubuntu-provided photographic wallpapers, reused across 96 cards.

1. Connect from the actual uniTerm webpage at 1920x1080, fit-to-window, balanced.
2. Compare Compatibility and Smooth (experimental) against the **same server**.
   Check the server log for `starting gfx rfx pro codec session` in Smooth mode.
3. Insert an isolated server-to-client TCP limiter (2,500,000 bytes/s upper bound,
   then 1,250,000 bytes/s). Do not throttle the host's entire interface.
4. Jump between scrollY=0 and 900 every 2.5 seconds, six times. Record actual
   WebSocket byte counts and putImageData timestamps/rectangles using an init
   script before loading the application. Use the remote page's Date.now() and
   client performance.timeOrigin+performance.now() for same-host latency timing.
5. Separately record real mouse wheel inputs through uniTerm (120 units at a
   time); assert that the remote scroll position actually changes. Do not include
   recording/screenshot overhead in the timing measurement. Verify no remote
   desktop notifications obscure the page.
6. Inspect complete-frame presentation, not only draw-call duration. Keep raw
   measurements and real-time recordings; do not equate atomic presentation
   with 60fps or zero input latency.
7. Reconnect, switch modes both ways, and test a legacy server. Verify the mode
   persists after application reload. Resize and confirm canvas/desktop extents
   agree and no decode or page errors occur.

This scenario cannot establish Windows codec negotiation or hardware GPU
performance. GFX RFX Progressive is lossy; inspect text and image quality as well
as bandwidth. Large individual WASM decodes remain synchronous and may block the
browser main thread. H.264/WebCodecs is a separate follow-up, not part of this fix.

## Driver

`compare.mjs LABEL` drives the complete packaged frontend (no WASM substitution).
It expects Playwright installed, a test uniTerm URL, the remote desktop browser's
CDP endpoint bound to localhost, and a server-to-client limiter reachable from
uniTerm at `host.docker.internal:13391`. The remote browser page must have the
same gallery loaded (the test fixture may be named `index.html`).

Set `RDP_ARTIFACT_DIR`, `UNITERM_TEST_URL`, `REMOTE_BROWSER_CDP`, and
`RDP_CREDENTIALS_FILE`. The last points to a private JSON file with `username`,
`password` (desktop account), and `adminPassword` (isolated uniTerm admin).
Never commit that file. A label starting with `old` selects compatibility;
other labels request GFX. Run separate apps to compare the old published image
with the new image. The driver records raw timing JSON and timestamped JPEGs
for a separate real-input recording. It asserts that wheel input changed the
remote page's scroll position. Change the limiter rate between cases, not while
a case is running. Run cases sequentially because they share one desktop.
