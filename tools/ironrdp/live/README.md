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

## RDPSND audio regression

The `0.5.1-uniterm.3` bundle adds a PCM output callback. Test against a dedicated
xrdp desktop with `pulseaudio-module-xrdp` loaded and its sink connected to the
isolated chansrv audio socket. Play a 3-second stereo WAV (440 Hz left, 880 Hz
right) with `paplay --device=xrdp-sink`. Capture the browser Web Audio merger's
output with a test-only ScriptProcessor tap; don't inject PCM directly into the
frontend. Verify the two frequency peaks and non-zero RMS. Repeat after changing
remote sink volume to 50%, muting, and restoring to 100%; assert reduced RMS,
zero RMS, and restored RMS respectively. Disconnect and assert AudioContext is
closed. See `audio-results-20261112.json` for the measured Linux/Chromium run.
The browser did not block autoplay during that run; blocked playback and stale
queue behavior are covered by unit tests, not a claimed live policy test.
Windows server codec negotiation and other browsers remain unverified.

## Input-device regression

For `.4`, enable the microphone in Devices and record from the remote
`module-xrdp-source` using `parec --device=xrdp-source --format=s16le
--rate=44100 --channels=2`. Launch the test Chromium with a deterministic
1000 Hz WAV via `--use-file-for-fake-audio-capture`, fake media devices and
permissions in the isolated browser context. Confirm the remote recording's
FFT peak at 1000 Hz, rather than merely asserting that getUserMedia succeeds.

Browser-only camera validation uses Chromium's fake camera, calls the actual
`RdpCapture` adapter and verifies 640x480 JPEG output with a simulated request
callback. Protocol-level validation lives in `capture.rs` inside the WASM patch;
it is separate from a live Windows camera test. Neither test claims Windows
application compatibility. Stop individual devices, disconnect, and fail a
reconnect after permission grant; assert all required tracks end and output
stops. See `capture-results-20261112.json`.

Use `xev -event keyboard` on the isolated desktop to verify shortcut down/up
pairs. Exercise normal and fullscreen menus, including explicit F12. Disable
the test account's screensaver before screenshots to avoid mistaking its blank
or locked screen for a render failure.
