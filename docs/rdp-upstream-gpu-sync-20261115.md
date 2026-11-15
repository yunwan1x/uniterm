# RDP upstream comparison and GPU synchronization follow-up

The browser RDP path was compared with FreeRDP, Apache Guacamole, IronRDP's
upstream issue discussion, Microsoft's public RDP specifications, and WebGL
optimization guidance. This is a source/documentation comparison, not a review
of the Windows Remote Desktop client implementation.

## Findings that affect the implementation

- [FreeRDP EndFrame handling](https://github.com/FreeRDP/FreeRDP/blob/11bfdcf8453dcb63ce5e702cd9f71830f94a9efc/channels/rdpgfx/client/rdpgfx_main.c#L1550-L1648)
  processes the complete frame and sends a GFX acknowledgement with unavailable
  queue depth. Our ordering and value already match. Microsoft's
  [GFX ACK specification](https://learn.microsoft.com/en-us/openspecs/windows_protocols/ms-rdpegfx/0241e258-77ef-4a58-b426-5039ed6296ce)
  defines queue depth in bytes, with zero meaning unavailable. A GFX ACK refers
  to a decoded logical frame; the main-thread bitmap ACK is a different signal.
  This change preserves both mechanisms and all ordered graphics commands.
- [Guacamole's browser client](https://guacamole.apache.org/doc/1.6.0/guacamole-common-js/main_webapp_modules_Client.js.html)
  flushes ordered drawing work at complete-frame boundaries before its sync
  response. It supports retaining coherent frame boundaries, rather than
  discarding arbitrary region updates to increase apparent throughput.
- [IronRDP issue 790](https://github.com/Devolutions/IronRDP/issues/790)
  describes increasing lag during video and discusses Worker/WebCodecs/EGFX
  integration. uniTerm already uses these. The proposed lamco client source was
  private in the cited discussion, so its claimed performance is not an audited
  implementation or a drop-in AVC444 fix. AVC444 requires reconstruction from
  main and auxiliary pictures; decoded-picture counts are not display FPS.
- [Emscripten WebGL guidance](https://emscripten.org/docs/optimizing/Optimizing-WebGL.html#avoid-gpu-cpu-sync-points)
  and [MDN WebGL best practices](https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices#avoid_blocking_api_calls_in_production)
  identify synchronous queries and changing framebuffer attachments as avoidable
  hot-path costs. The existing compositor queried errors after each command;
  YUV conversion also checked framebuffer completeness and errors per region.

## Implemented change

Each surface/cache/scratch texture now owns a persistent framebuffer, configured
and validated at allocation. Its immutable texture storage is updated using
sub-images, clear and blit commands. All framebuffer objects are released with
their textures, including failed allocations and temporary overlap copies.

YUV conversion binds these existing framebuffers. Uniform locations and plane
texture parameters are initialized once. GPU error checks remain after texture
allocation, explicit test readback and each EndFrame, before presentation.
Context-loss checks remain during command handling. An EndFrame with no output
damage still checks errors, so failures on unmapped surfaces are not hidden.

This avoids per-region synchronization while retaining the existing failure
path. It does not change the decoder, RDP capabilities, ACK windows, transport,
output resolution or image quality. The vendored WASM remains uniterm.15.

## Verification

- TypeScript checking of the changed renderer modules passed.
- All 43 RDP worker/renderer/audio tests in eight files passed.
- Exact hardware-GPU YUV420/444 conversion passed six cases and 1,964 pixels,
  including cropped/odd dimensions and malformed input rejection.
- Persistent-surface pixel checks passed orientation, fill, self-copy, cache
  restoration across reset, YUV and patches after output transfer.
- The extended lifecycle check passed cross-surface copy, overlapping copy,
  cache restore/eviction/reset, target/standalone conversion interleaving,
  output resize and context loss. Seven compositor framebuffers were allocated
  and seven released. The portable regression is `gpu-lifecycle-check.mjs`.
- Production Vite and Linux server/gateway builds passed. Renderer tests used
  Windows Edge 157 with Intel UHD Graphics through ANGLE D3D11.

The synthetic 3840x2160 benchmark includes YUV upload, all region draws, complete
frame composition, output transfer and bitmap disposal. It uses four alternating
baseline/candidate rounds, six warmup frames and twenty measured frames per
round. Mean frame costs (lower is better):

| Regions per frame | Previous | Candidate | Reduction |
|---|---:|---:|---:|
| 1 | 42.79 ms | 40.88 ms | 4.5% |
| 16 | 48.89 ms | 45.34 ms | 7.2% |
| 64 | 57.73 ms | 45.05 ms | 22.0% |

These are renderer microbenchmarks, not end-to-end RDP FPS. At 64 regions, after
allocation, 26 frames previously made 1,664 framebuffer-completeness queries;
the candidate makes none. EndFrame and allocation error checking remain.

## Remaining diagnosis

Microsoft's [graphics performance counters](https://learn.microsoft.com/en-us/azure/virtual-desktop/remotefx-graphics-performance-counters)
separate server input/output frame rates and skipped frames due to server,
network or client resources. The counter sets were confirmed present on the
Windows 11 host; there was no active-session measurement in this check.
`Source Frames/Second` is unsupported; use input/output counters instead.

A follow-up long-stall investigation should correlate protocol frame IDs,
receive/decode/composition/ACK timestamps and actual browser draws, then compare
with the Windows counters during the same workload. Microsoft's
[StartFrame timestamp](https://learn.microsoft.com/en-us/openspecs/windows_protocols/ms-rdpegfx/9849fa1a-f896-4abe-9fd4-b7761f56b42c)
is packed UTC time-of-day, not a linear millisecond counter.

The isolated Linux test source uses xrdp 0.10.6.1, whose
[GFX frame window defaults to two](https://github.com/neutrinolabs/xrdp/blob/v0.10.6.1/xrdp/xrdp_encoder.c#L315-L364).
It is independent of the client's legacy max-unacknowledged-frames capability.
Neither changing that capability nor enabling optional QoE ACKs is established
as a fix. The current WebSocket/TCP path also does not acquire RDP UDP support
merely by changing a Windows policy.

## Live RDP comparison

Each accepted round recreated the owned xrdp container, waited for a fresh
session log and the animated source browser, verified the source AudioContext,
then warmed up and sampled approximately twelve seconds. A stale-session
attempt that produced no PCM is excluded. The first clean baseline overlapped
the end of ARM compilation; the second pair ran after all compilation finished.
Source animation remained approximately 43–45 FPS. Both pairs used the same
NAS HTTPS gateway path and hardware browser.

| Round | Draw submissions/s | p95 gap | Maximum gap | New audio underruns |
|---|---:|---:|---:|---:|
| Previous 1 | 8.13 | 181 ms | 676 ms | 0 |
| Candidate 1 | 9.59 | 135 ms | 190 ms | 0 |
| Previous 2 | 8.94 | 153 ms | 210 ms | 0 |
| Candidate 2 | 9.68 | 136 ms | 176 ms | 0 |

The second pair improves submission rate by about 8.3%. YUV processing per
picture falls from about 18.8 ms to 7.3 ms. The source and presentation counts
are deliberately separate. All accepted rounds received real PCM, had no new
overflows and no browser errors; the first accepted candidate also delivered an
F8 key to the source browser. These short Linux AVC420 samples do not establish
Windows AVC444 performance or elimination of occasional long stalls. Detailed
numeric evidence is in `tools/ironrdp/results/rdp-gpu-sync-20261115.json`.


## Router delivery

The ARM64 build passed UPX integrity checking and isolated-router HTTPS
acceptance: 9.16 draw submissions/s, 151 ms p95 gap, 649 ms maximum gap,
nonzero AVC420 and PCM, no new audio underruns/overflows, no page errors, and
an F8 key delivered to the source. The long gap remains; this is an overhead
reduction, not a complete fix for every stall. This router round has no matched
router baseline and must not be presented as a router speedup measurement.

Code commit: `560fd1ac6e94036973036e481d2a692ffdd78bd8`.

- Archive: `uniterm-0.3.0-rc.5-560fd1ac-arm64.tar.gz`, 15,559,568 bytes.
- Archive SHA256: `8ce8d6f613f6b159744f5977a94e6c83665005e7daf374e2be74738aa1485ab5`.
- Server SHA256: `821c11ef829baf7b4e060c0e0be0ebc72cc9216e707ed8ad4f114d6be4973eb0`.
- Gateway SHA256: `22d3c4d6c805d92661f9b2b1ac7945e9e28f0478174f74928d324a4684c596a5`.

The archive reuses the previous installer/gateway and replaces the embedded
frontend server. The rc.4 archive is retained on the NAS for rollback. The
production server at `https://192.168.50.1:18888` was updated, `/health` returned
OK and both installed hashes were verified. An initial script accidentally
probed protected `/api/health`, causing automatic rollback; the public endpoint
was corrected and the subsequent installation passed. Reload and reconnect
existing browser tabs to receive the new worker code.


## Verified native diagnostic

FreeRDP 2.11.7 on the Linux control host, using Xvfb and AVC420 against the
same owned xrdp server and verified animated/visible source, processed 456
H264_METABLOCK trace events in twelve seconds (38.0 codec updates/s). The source
advanced at approximately 46.0 FPS with its AudioContext running. Monotonic
log-receipt gaps had a 70.5 ms p95 and 120 ms maximum. The fake RDPSND backend
negotiated an audio channel; it did not validate audible playback.

These events are codec updates, not logical EndFrames or visible refreshes.
The packaged client did not emit StartFrame/EndFrame trace messages. Client
hardware, display backend and transport differ from the Windows browser path;
this is not a matched native-vs-browser speedup benchmark. It does demonstrate
that this test source is capable of supplying substantially more than nine
codec updates per second, motivating further analysis of browser decoding,
pixel copies and output transfer. Raw log timestamps were unsuitable for gap
calculation; the accepted gaps use monotonic line receipt and include logging
and pipe scheduling. They cannot prove absence of physical display stalls.
