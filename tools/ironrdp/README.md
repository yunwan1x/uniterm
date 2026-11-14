# uniTerm RDP presentation patch

The shipped dependency is `frontend/vendor/ys-ll-ironrdp-wasm-0.5.1-uniterm.12.tgz`.
It replaces the external v0.5.1 tarball, so normal frontend/Docker builds do not
need a Rust compiler. `Dockerfile` copies `vendor/` before `npm ci`.

## Provenance

- IronRDP base: `905c28b3a4e67b15fac274c5d808ef3cef0eb813`.
- Existing uniTerm patches: `ys-ll/ironrdp-wasm` tag `v0.5.1`, commit
  `d39ce5b728465c29b1955b3cc218d623183820d6` (autologon, quality options,
  finalization tolerance). These are retained in the combined patch.
- `patches/uniterm.patch` is the complete diff against that IronRDP base,
  including new source files and regression tests.
- The tarball includes IronRDP's Apache-2.0 and MIT license texts.

## Changes

1. Exact dirty rectangle extraction. The contiguous full-row copy path is used
   only for genuinely full-width damage. A 64x128 rectangle on a 1920px-wide
   desktop now copies 32 KiB instead of 960 KiB.
2. Protocol updates still decode in order into the existing framebuffer. Completed-frame
   presentation is batched; the opt-in scheduling below also defers graphics
   commands without dropping protocol packets or dependent deltas.
3. Merge pending rectangles when their bounding box costs no more than 25%
   extra pixels. Keep distant regions separate, with at most 32 pending regions
   before falling back to one bounding rectangle. This bounds hidden-tab memory.
4. Present via requestAnimationFrame. One outstanding callback per session,
   cancelled on resize/reset/disconnect. An idle final update still schedules a
   frame; rendering does not depend on another network message arriving.
5. Yield to the browser after approximately 8ms of processing buffered events,
   so a burst cannot indefinitely starve RAF/input tasks. Individual PDU decoding
   remains synchronous and cannot be preempted by this budget.

6. Opt-in EGFX: the `graphics_pipeline` extension requests 32-bit color,
   advertises the GFX early capability, and registers `GraphicsPipelineClient`
   alongside Display Control in the same DRDYNVC channel. The pinned engine's
   existing compositor applies surface/cache commands and only releases updates
   after EndFrame. Its capabilities exclude AVC when no H.264 decoder is supplied.
7. Handle GFX ResetGraphics extent changes without requiring DeactivateAll:
   clear damage from the old extent and resize/redraw the canvas at presentation.

The connection form and normal/fullscreen RDP toolbar expose **Smooth** and **Compatibility**. New connections and saved connections without
`rdpGraphicsMode` default to Smooth. An explicit `rdpGraphicsMode: "legacy"`
keeps the compatibility fallback. The frontend passes the selected mode to the
WASM extension on every connect; the low-level extension itself stays opt-in.
Switching reconnects. A server without GFX can still choose legacy graphics;
selecting Smooth is a requested mode, not proof of the negotiated codec.

The original presentation iteration described below did not include WebGL2, Worker, WebCodecs or H.264. That iteration
uses the pinned engine's existing ClearCodec/Planar/RemoteFX/Progressive support.
Actual Linux tests negotiated GFX RemoteFX Progressive. The Go transport and
credential-handling paths are unchanged.

## Rebuild production package

Prerequisites: Git, Node 22+, npm, Rust with wasm32-unknown-unknown target,
`wasm-bindgen-cli` **0.2.129**. This build was validated with rustc 1.99.0.

```sh
cargo +stable install wasm-bindgen-cli --version 0.2.129 --locked
./tools/ironrdp/build.sh
cd frontend
npm install --package-lock-only --ignore-scripts
npm ci
npm run build
```

The script uses a fresh temporary checkout by default. `IRONRDP_BUILD_DIR` can
point to a clean checkout; it must not contain the patch already. `RUST_TOOLCHAIN`
can pin an installed Rust toolchain. The benchmark feature is excluded from the
production tarball.

## Regression tests and browser replay

In the patched IronRDP checkout:

```sh
cargo +stable test -p ironrdp-web --lib --locked -- --skip clipboard::tests
cargo +stable test -p ironrdp-egfx --lib --locked
cargo +stable build --locked -p ironrdp-web --target wasm32-unknown-unknown \
  --release --features render-benchmark
wasm-bindgen target/wasm32-unknown-unknown/release/ironrdp_web.wasm \
  --target web --out-dir /tmp/rdp-replay/pkg --out-name ironrdp
```

The native test command skips upstream clipboard tests that invoke browser-only
WASM APIs on native targets. It includes exact extraction, bounded region merging,
connection configuration and existing session tests.

Copy `benchmark.html` into `/tmp/rdp-replay`, serve that directory on localhost,
and run `benchmark.mjs URL OUTPUT.json` with Node 22+ and Playwright installed.
`PLAYWRIGHT_MODULE` may point to an existing Playwright `index.mjs`.

The replay builds both paths from the same Rust code. Baseline reproduces the
original immediate drawing and full-row expansion; batched uses the production
`Damage`, `extract_region` and `Canvas` implementations. It runs three rounds,
alternates baseline/batched order, and compares every output pixel. It also tests
resize invalidation, edge pixels and cancellation of pending RAF callbacks.

It does **not** benchmark live RDP traffic, Windows server encoding, protocol
decoding, a real GPU, or network latency. Framebuffer mutations use deterministic
synthetic patterns. `draw*Ms` isolates extraction + alpha normalization +
ImageData creation + Canvas submission; `work*Ms` also includes synthetic pattern
generation and region bookkeeping. GPU completion is not measured by these CPU
timers. See `results/` for the measured environment and decision.

## Browser audio

The audio callback extension negotiates mono/stereo 8/16-bit PCM (8–48 kHz) through RDPSND. Web Audio playback follows server channel volume; no separate playback volume UI is added. Browser autoplay blocking exposes a click-to-enable prompt. Queues are bounded and disposed on disconnect.

## Browser input devices and keys

The RDP status bar and fullscreen toolbar include a Keys menu. Each shortcut
sends a balanced scancode transaction (including explicit F12) after releasing
previous held inputs. There are no persistent pressed modifiers in this menu.

Devices are off by default and are not persisted or restored automatically.
The Devices menu obtains browser consent before reconnecting and advertising
`AUDIO_INPUT` or `RDCamera_Device_Enumerator`. HTTPS/localhost and remote host
redirection policy are required. Revocation, tab teardown and unexpected
connection loss stop the local tracks. An intentional device-change reconnect
retains consented streams and ignores disconnect events from the old proxy.

- Microphone: AudioWorklet mono capture, streaming resampling to negotiated
  8–48 kHz mono/stereo PCM16, fixed-size RDPEAI packets, epoch checks on format
  changes. The worklet allows only one unacknowledged message.
- Camera: one 640x480 MJPEG stream at up to 10 fps; JPEG encoding only when the
  server has a pending Sample Request. One encoding job at a time, 512 KiB frame
  cap, epoch checks on stream restart. No H.264 camera encoder is advertised.
- Both use the existing DRDYNVC channel and bound pending capture events.

Live Linux xrdp/Chromium tests verify microphone redirection into the remote
PulseAudio source. Browser fake-device tests verify camera JPEG capture and
track release; Rust wire-protocol tests verify enumeration, media negotiation,
sample requests and stale-frame rejection. The xrdp test server does not provide
a Windows RDPECAM consumer: camera compatibility with Windows applications is
not yet live-verified. Do not represent those protocol tests as a Windows test.

### Windows audio channel dependency (uniterm.5)

When audio playback is enabled, the web client now registers both `rdpsnd` and
`rdpdr`, as required by MS-RDPEA Appendix A, note 1 for Windows. If printing has
already installed an RDPDR processor, it is retained. Otherwise an RDPDR
processor with `NoopRdpdrBackend` handles protocol negotiation with an empty
device list; this does not enable drive or printer redirection.

Regression coverage checks that enabling audio installs RDPDR without printing,
that disabled audio does not install it, and that an existing processor is not
replaced. The vendor package and frontend lockfile are updated together to
`0.5.1-uniterm.5`.

Validation on 2026-11-12: WASM release build, frontend production build,
42 RDPDR library tests, 35 native-compatible web tests and 6 browser audio-player
unit tests passed. The native web suite's clipboard tests require JavaScript
imports: running the entire suite natively yields 19 environment failures;
they are excluded from the compatible subset, not reported as passing.
The patch applies cleanly to the pinned upstream commit.

Windows acceptance remains pending access to the user's `wy` session: reconnect
with the new client, invoke Windows' sound Test action, and verify received PCM
buffers with non-zero amplitude and audible left/right output. An established
Remote Audio device alone does not establish successful playback. This fix
requires serving the rebuilt frontend and reconnecting existing RDP sessions.

## Worker / WebCodecs follow-up (uniterm.6)

The frontend now defaults to a dedicated protocol worker with bounded complete
ImageBitmap snapshots. The WASM canvas bridge accepts OffscreenCanvas and its
scheduler supports worker globals. A nested WebCodecs worker implements AVC420
through a bounded shared-memory bridge; each surface has an independent decoder.
That revision did not advertise AVC444. HTTPS/localhost and cross-origin isolation are required
for the AVC bridge; the worker can still use existing codecs without them.
WebGL2 is selected on hardware-capable contexts, with software-GPU avoidance and
automatic Canvas recovery. No user mode selection is required.

See `../../docs/rdp-worker-performance-20261112.md` and `worker/README.md` for measured results, fallback tests, and limitations.

Browser file transfer uses package revision `.7`. It tolerates an xrdp
`clipDataId` only when `CAN_LOCK_CLIPDATA` was not negotiated; negotiated
unknown locks still fail. The combined patch includes the regression test in
`ironrdp-testsuite-core/tests/clipboard/lock_timeout.rs`. Run it with
`cargo +stable test --locked -p ironrdp-testsuite-core --test integration_tests_core clipboard`.

## Audio queue revision (uniterm.8)

RDPSND uses a separate 256 KiB PCM queue, drained after each protocol event
before handling graphics outputs or reading another buffered PDU. PCM no longer
competes with input/clipboard events in the fair-select input queue. Control
events retain protocol order, and JS callbacks execute without holding the queue
lock. Individual graphics PDU processing still cannot be preempted; this change
does not promise uninterrupted playback under arbitrary server/network stalls.

## AVC444 YUV and channel priority revision (uniterm.11)

The WebCodecs bridge now exposes raw I420/NV12 planes with validated offsets
and row strides. It preserves the samples required by AVC444 rather than
converting its auxiliary picture to RGB. Both pictures of a surface's AVC444
stream use the same decoder, in protocol order. AVC420 and AVC444 both select
the correct per-surface decoder. The nested worker decodes a small H.264 probe
and successfully reads its YUV planes before the session advertises AVC444.
Unsupported clients retain the existing codec fallback.

RDPSND requests high MCS priority. Statistics expose native audio dispatch gaps,
source timestamp gaps and wall-clock worklet arrival gaps, alongside the audio
render clock, so source/transport stalls can be distinguished from playback
queue behavior. Timestamp-gap statistics wrap at 16 bits for compatibility with
older Wave PDUs; they do not alone establish the cause of a source delay.

Windows live testing negotiated graphics protocol 10.7 with AVC available, and
received actual AVC frames. This establishes codec interoperability, not proof
that all real-video audio regressions have passed.

## Deferred graphics scheduling (uniterm.12)

The browser opts into a bounded FIFO of parsed graphics commands. Receiving
DRDYNVC data decompresses and parses messages without synchronously decoding
their pictures. After connection finalization, the session drains ready network PDUs first,
including RDPSND, and executes one graphics command when the receiver has
caught up. A 4 ms receive-work budget and queue high-water marks ensure
continuous traffic cannot starve graphics or exhaust the queue. Graphics
commands retain their order and frame ACKs follow actual EndFrame processing.
The queue fails closed at 64 MiB or 16,384 commands; reference frames are never
dropped to make room. Closing/reopening a channel releases pending work.
Other IronRDP clients retain synchronous processing unless they explicitly opt in.

Native coverage checks deferred surface creation/deletion, ordered frame ACKs,
overload rejection and channel cleanup. Live Windows 4K acceptance passed with
AVC444 preferred: sustained tone, natural YouTube audio and a concurrent moving
720p H264 fixture had no new underruns, recovery silence or dropped PCM during
the measured scrolling intervals. Mixed legacy graphics still had underruns.
The router now runs rc.3, and audio reserve limits are unchanged. See
`../../router-plugin/output/rdp-acceptance.json` for measurements and limits.
