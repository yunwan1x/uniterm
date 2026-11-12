# uniTerm RDP presentation patch

The shipped dependency is `frontend/vendor/ys-ll-ironrdp-wasm-0.5.1-uniterm.2.tgz`.
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
2. Protocol updates still decode in order into the existing framebuffer. Only
   presentation is deferred; no protocol packets or dependent deltas are dropped.
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

The connection form and normal/fullscreen RDP toolbar expose **Smooth
(experimental)** and **Compatibility**. Existing connections default to
Compatibility; `rdpGraphicsMode: "gfx"` opts in and persists with the connection.
Switching reconnects. A server without GFX can still choose legacy graphics;
selecting Smooth is a requested mode, not proof of the negotiated codec.

No WebGL2, Worker, WebCodecs or H.264 implementation is included. This iteration
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
