# RDP audio and video lifecycle fixes (2026-11-17)

Source revision: `b11fc61b` (`0.3.0-rc.12`). The bundled IronRDP dependency is
`frontend/vendor/ys-ll-ironrdp-wasm-0.5.1-uniterm.19.tgz`.

This change addresses five reproducible playback or session-lifecycle defects.
It builds on the processor-error recovery in
[the earlier audio fix](rdp-audio-recovery-20261117.md). This document records
implementation and validation; it does not report a router deployment or a
Docker publication.

## 1. Short sounds could wait indefinitely for another packet

The AudioWorklet previously started only after collecting one packet plus its
jitter reserve, unless it received an explicit end event. A single short sound
could remain below that threshold indefinitely. RDPSND Close ends an audio
transmission; it is not a reliable delimiter for every notification sound.

The worklet retains the existing continuous-stream threshold and also sets a
fixed startup deadline when the first queued packet arrives. The deadline is
that packet's duration plus the current reserve, capped at 750 ms. Later packets
do not postpone it. Playout starts when enough data is buffered, the deadline
expires, or Close permits the queued tail to drain. The same rule applies after
starvation. Reset, mute, suspension and sample-rate changes discard the old
samples and deadline together.

With the initial 120 ms reserve, isolated 20 ms and 100 ms packets start after
approximately 140 ms and 220 ms respectively, subject to the audio render
quantum. The finite wait preserves a reserve for continuous audio while making
short sounds playable without Close.

## 2. A completed stream could leave the player in its playing state

After Close and exhaustion of the queued tail, the worklet could retain
`playing = true`. A subsequent stream then bypassed startup buffering, played its
first packet immediately and could underrun before the following packets.

An empty ended stream now clears the playing state. Both event orders are
covered: Close before the tail drains, and Close after the last sample drains.
The state is also cleared when the last sample falls exactly on a 128-sample
render boundary, before fresh PCM can arrive between render calls. Queued tail
samples are preserved.

These audio changes are in
[`pcmPlayback.worklet.js`](../frontend/src/utils/pcmPlayback.worklet.js), with
regressions in
[`pcmPlayback.worklet.test.ts`](../frontend/src/utils/pcmPlayback.worklet.test.ts).

## 3. Deleted video surfaces retained decoders and stale asynchronous work

An AVC decoder was retained for each surface even after the corresponding EGFX
surface was deleted. Repeated creation/deletion could exhaust the existing
limit of 16 simultaneous decoder states. Surface-ID reuse could also retain
reference frames from the previous stream.

The `.19` WASM package calls a dedicated surface-lifecycle callback on creation
and deletion. It releases that surface's decoder while preserving other
surfaces. Both AVC444 pictures belonging to the same surface share its decoder
lifetime. The 16-live-decoder limit remains in place; this fix releases obsolete
entries instead of raising the limit.

The callback is independent of the optional GPU command bridge. Canvas2D
sessions therefore receive decoder-release notifications without installing a
GPU bridge or constructing unused RGBA arguments. GPU sessions preserve the
ordering of decoder release and surface lifecycle commands.

Release/reset also handles decoder objects already closed by a browser error.
Late output callbacks and completed `copyTo()` promises check the request and
decoder identity before publishing pixels. If a YUV readback is cancelled while
`copyTo()` is still writing, the next request receives different scratch
storage; the abandoned copy cannot overwrite the replacement stream. The
session worker ignores completion messages from older timestamps without
clearing a newer request or its timeout.

Implementation and regression details:
[`avc.worker.ts`](../frontend/src/rdp/avc.worker.ts),
[`session.worker.ts`](../frontend/src/rdp/session.worker.ts), and
[the IronRDP package notes](../tools/ironrdp/README.md#avc-surface-lifecycle-uniterm19).

## 4. A renderer fallback could be lost during a reconnect

Renderer or codec failure can arrive while `connect()` is still unwinding.
Previously, calling reconnect at that point could hit the existing reconnect
guard and discard the fallback request.

Renderer, codec and security fallback requests now use one pending-fallback
path. A request arriving during a reconnect is coalesced and serviced after the
current reconnect finishes. Existing per-fallback attempt guards remain, and
component disposal prevents queued work from opening another connection.

## 5. Closing a panel could leave a late backend session alive

A backend `CreateSession` request can finish after the RDP panel has closed or
a newer client generation has superseded it. Previously that late result could
be bound to the removed panel or leave its proxy session alive. The adaptive
resize reconnect path had the same asynchronous lifetime concern.

Normal and resize-triggered connection paths now check disposal, client
generation and session identity after asynchronous boundaries. An obsolete
backend session is explicitly closed before binding or starting a client.
Pending reconnect completion also checks disposal before retrying or scheduling
another resize.

The two session fixes are in
[`RDPTabContent.vue`](../frontend/src/components/RDPTabContent.vue), with focused
async regressions in
[`rdpSessionLifecycle.test.ts`](../frontend/src/utils/rdpSessionLifecycle.test.ts).

## Validation

- The targeted integration/regression suite passed **99 tests**, covering the
  combined audio, video and session-lifecycle changes.
- The audio subset passed **37 tests**: 13 direct worklet tests, 19 existing PCM
  playback tests and 5 processor-recovery tests. Worklet cases include isolated
  short sounds, continuous 40/160 ms packets, delayed bursts, rebuffering,
  mute/suspend/reset, format changes and both Close/render-boundary event orders.
- AVC regressions exercise 32 sequential surface IDs, same-ID reuse, the two
  AVC444 pictures, decoder errors, delayed outputs and cancelled readbacks.
- The real-WASM bridge fixture passed **10 checks**. These include lifecycle
  callbacks on both renderer paths, preservation of GPU command ordering and
  zero unused RGBA copies when the GPU bridge is absent. See
  [the fixture documentation](../tools/ironrdp/gpu-bridge-regression/README.md).
  These checks execute WASM forwarding; they do not substitute for a live GPU
  driver or an end-to-end Windows AVC444 session.
- Full `vue-tsc` still reports **567 baseline diagnostics**. The baseline
  comparison found no new diagnostics; this is not a clean full typecheck.
- `git diff --check` passed for the implementation.

### Real-browser short-audio comparison

A Chromium test loaded the production worklet source, resumed its AudioContext
from a click, and sent one 100 ms, 48 kHz, mono 16-bit PCM sine packet. An
AnalyserNode measured actual rendered output. No Close was sent during the
initial three-second observation.

| Observation after three seconds | Before | After |
| --- | ---: | ---: |
| Received packets / bytes | 1 / 9600 | 1 / 9600 |
| Buffered audio | 100 ms | 0 ms |
| Measured output peak | 0 | 0.30517578125 |

In the old implementation, sending Close after the observation released the
previously silent packet and produced the same nonzero peak. With the fix, it
played during the initial observation without Close. This distinguishes the
buffer-start defect from an invalid PCM format or autoplay rejection.

The local test artifacts are
`/root/uniterm-audio-audit/browser-results.json` (before),
`/root/uniterm-audio-fix/browser-results.json` (after), and
`/root/uniterm-audio-fix/browser-check.mjs` (browser harness). Fault injection or
browser test fixtures are not included in the production worklet.

## Evidence limits

These tests establish the specific code defects and the exercised recovery
behavior. They do not establish the cause of the reported Windows RDP audio
outage that required a Windows restart, nor prove that the live Windows session
exhausted its decoder limit. Distinguishing a Windows audio/RDPSND failure from
a browser failure still requires evidence from the affected session.

Without an explicit stream end, existing underrun counters also include periods
when no fresh PCM is supplied after a sound finishes. An underrun counter alone
is therefore not proof of network packet loss. This change keeps that diagnostic
semantics while correcting finite startup and completed-stream playback state.
