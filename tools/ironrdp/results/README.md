# RDP presentation results — 2026-11-12

## Decision

Ship the batched Canvas 2D path first. Do not add WebGL2 to the production path
based on this test alone. The targeted narrow/overlapping-damage problem improves
substantially. Full-screen traffic still costs roughly the same amount of pixel
work, so a 4K/high-motion workload is a candidate for a separate GPU-rendering
investigation. This is not a claim that live RDP stutter has been eliminated.

## Method and limitations

- Actual Rust/WASM `Canvas`, extraction and region-merging code; original versus
  optimized policy replayed with deterministic framebuffer changes.
- Chromium 145 headless on Linux; WebGL capability reports ANGLE/SwiftShader
  software rendering, **not a physical GPU**. No WebGL2 implementation was compared.
- 1080p and 4K; four workloads; three repetitions, alternating execution order.
  Each repetition has 8 warm-up and 60 measured frames per implementation.
- Figures below are the median of the three per-run P95 CPU drawing times.
  Timings include extraction, alpha normalization, ImageData construction and
  Canvas submission. They do not measure GPU completion or live RDP decoding.
- Synthetic frame generation is measured separately in raw `work*Ms`; it should
  not be interpreted as Windows/RDP decoding cost. Network, server-side codecs,
  true end-to-end latency and the user's actual Windows session were not tested.
- Every final framebuffer matched byte-for-byte in all 24 paired comparisons.
  Resize/edge-pixel validation and RAF cancellation/idle wake-up also passed.

| Workload | Resolution | Old draw P95 | New draw P95 | Calls per 60 frames, old → new | Copied data, old → new |
|---|---|---:|---:|---:|---:|
| 12 overlapping 64×128 updates/frame | 1920×1080 | 3.4 ms | 0.1 ms | 720 → 60 | 675 MiB → 1.875 MiB |
| 32 adjacent 64×64 tiles/frame | 1920×1080 | 0.4 ms | 0.3 ms | 1920 → 60 | 30 MiB → 30 MiB |
| 16 distant 24×24 updates/frame | 1920×1080 | 0.2 ms | 0.2 ms | 960 → 960 | unchanged |
| One full-screen update/frame | 1920×1080 | 3.2 ms | 3.1 ms | 60 → 60 | unchanged |
| 12 overlapping 64×128 updates/frame | 3840×2160 | 5.8 ms | 0.1 ms | 720 → 60 | 1350 MiB → 1.875 MiB |
| 32 adjacent 64×64 tiles/frame | 3840×2160 | 0.4 ms | 0.3 ms | 1920 → 60 | unchanged |
| 16 distant 24×24 updates/frame | 3840×2160 | 0.2 ms | 0.2 ms | 960 → 960 | unchanged |
| One full-screen update/frame | 3840×2160 | 12.8 ms | 11.8 ms | 60 → 60 | unchanged |

Call reductions alone do not guarantee proportionate speedups; the tiled and
full-screen cases demonstrate this. A frame may also wait up to the next browser
refresh before presentation. Hidden tabs pause RAF but continue to accumulate
bounded damage and process protocol messages.

## Validation

- 28 native Rust tests passed (including five new extraction/merging tests).
  Upstream browser-only clipboard tests were excluded from the native run;
  attempting to run all of them natively fails on unsupported WASM imports.
- Production WASM compiled with Rust 1.99.0 and wasm-bindgen 0.2.129.
- Clean npm install from the checked-in local tarball and frontend build passed.
- 74 uniTerm RDP frontend regression tests passed.

The raw samples and exact browser identification are in `chromium-replay.json`.

Production tarball SHA-256:
`778e85fa3fad03e7b6e86052e31298a02e6c467f984b9c9c19f112706a738829`.
The production module was also instantiated in Chromium; SessionBuilder,
DesktopSize and Extension construction passed, and benchmark exports were absent.
