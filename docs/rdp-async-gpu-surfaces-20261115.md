# RDP asynchronous decode and persistent GPU surfaces

The protocol worker no longer blocks in `Atomics.wait()` while WebCodecs decodes a picture. The Rust session prepares the next ordered EGFX command through a retained JS future and continues receiving network traffic, dispatching audio and servicing inputs while that future is pending. The synchronous decoder adapter consumes only those already prepared pictures.

Only one graphics command is prepared at a time, with at most two pictures for AVC444. The first picture is copied before shared output is reused; the final picture remains a view until the command consumes it. Reset generations reject late output. The existing 64 MiB / 16,384-command protocol queue remains bounded. No encoded reference picture or drawing command is discarded, and the protocol frame ACK follows actual EndFrame processing.

On a verified hardware WebGL2 renderer, persistent RGBA surface textures handle bitmap patches, solid fills, overlapping surface copies, cache copies, output mapping and scaling. Cache entries survive output resize and are released on eviction/channel close. GPU allocations are bounded; unsupported renderers, context loss, mixed legacy drawing or allocation failures reconnect through the existing compatibility renderer.

AVC420 remains YUV until a shader applies the exact RDP integer transform. AVC444 retains the existing ordered main/auxiliary plane reconstruction, then performs its reverse chroma filter and color conversion on the GPU. Completed surfaces compose directly into the output canvas. Normal video does not convert to a full RGBA CPU image or read the GPU result back into WASM. Alpha's CPU read-modify-write codec may request an exceptional surface readback. WebCodecs `VideoFrame.copyTo()` and YUV copies still exist: this is not an end-to-end zero-copy decoder.

Presentation remains independent: one in-flight ImageBitmap, accumulated damage, latest completed surface state and document RAF. Slow display consumers merge presentation work without dropping protocol dependencies.

## Validation

- Combined source patch applies cleanly to pinned IronRDP `905c28b3a4e67b15fac274c5d808ef3cef0eb813`.
- EGFX: 72 native tests, including external YUV rendering and ACK order; web: 36 native-compatible tests. Browser-only clipboard tests are excluded from native execution.
- Frontend RDP/audio tests and worker TypeScript checks pass; production Vite/WASM builds pass.
- Browser pixel checks cover exact 420/444 transforms, orientation, preserved patches, overlapping self-copy, cache survival after reset, and no normal-video readback.
- Full frontend run passed 1,306 tests; `tabSnapshot.test.ts` failed to load because its document mock has no `addEventListener`. The same failure reproduces on the unchanged baseline.

## Live comparison

Both clients used the same Win11 headless Edge instance with verified Intel UHD hardware rendering, 3840×2160 desktop, source account, YouTube 3840×2160 video, backend and scrolling/preview sequence. Both negotiated AVC support; the candidate additionally recorded actual AVC444 GPU draws. The preview assertion requires a visible animated WebP thumbnail, not a second HTML video.

| Windows scenario | Baseline FPS | Candidate FPS | Baseline p95 gap | Candidate p95 gap | Baseline maximum | Candidate maximum |
|---|---:|---:|---:|---:|---:|---:|
| Playback | 7.83 | 8.53 | 147 ms | 134 ms | 241 ms | 170 ms |
| Scroll and thumbnail preview | 6.87 | 8.29 | 231 ms | 145 ms | 330 ms | 163 ms |
| Recovery | 7.00 | 8.59 | 179 ms | 129 ms | 322 ms | 210 ms |

Both versions had zero new audio underruns/overflows in this final comparison and nonzero measured output RMS. The candidate recorded zero RGBA GPU readbacks and actual AVC444 GPU processing in all phases. These results show improved pacing, not 60 FPS or parity with Windows App. Decode/YUV extraction remains a material cost. Android hardware and a controlled Windows App comparison have not been tested.

A separate Linux-source AVC comparison on the same hardware receiver improved from 4.98 to 10.13 FPS, with p95 gaps 628→118 ms. An earlier intercepted baseline did not enable AVC and is excluded. The Linux audio source produced no PCM, so it does not establish audio continuity. A synchronous GPU readback prototype regressed and was replaced by the persistent surface path; requesting software decoding did not produce a stable benefit and is not shipped.

Reproducible GPU checks are `tools/ironrdp/worker/yuv-gpu-check.mjs` and `gpu-compositor-check.mjs`, against the frontend Vite origin selected by `UNITERM_RENDER_TEST_ORIGIN`. Set `PLAYWRIGHT_MODULE` and `CHROMIUM_EXECUTABLE` as in the existing renderer harness. The scripts print concise results and save no snapshots.
