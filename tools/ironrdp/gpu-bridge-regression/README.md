# GPU bridge regression

This checks that the Canvas2D fallback does not clone RGBA pixels for an unavailable GPU bridge, while preserving callable bridge behavior. It compiles the selected checkout's actual `gpu.rs` and drives `GraphicsPipelineClient.process` with small, hand-authored uncompressed EGFX PDUs. A JavaScript `Uint8Array` constructor proxy counts typed-array copies; this is a copy-count regression test, not a timing benchmark.

Run from any directory:

```sh
IRONRDP_CHECKOUT=/absolute/path/to/patched/IronRDP \
  sh tools/ironrdp/gpu-bridge-regression/run.sh
```

Prerequisites: Python 3, Node.js, Rust with the `wasm32-unknown-unknown` target, and `wasm-bindgen` CLI **0.2.129** on `PATH`. The fixture fixes `wasm-bindgen` to 0.2.129 and `js-sys` to 0.3.106; its checked-in `Cargo.lock` pins all dependencies. Use a checkout compatible with this lockfile. The runner uses `--offline --locked`, so Cargo's cache must already contain those dependencies; it does not download or update them.

The runner inherits `RUSTUP_HOME`, `CARGO_HOME`, `RUSTUP_TOOLCHAIN` and `PATH`. Select the Rust toolchain explicitly with `RUSTUP_TOOLCHAIN` if necessary; the temporary fixture is outside the checkout and does not inherit that checkout's `rust-toolchain.toml`. Optional `CARGO_TARGET_DIR` reuses an existing build cache; do not run another build in that cache concurrently. `GPU_BRIDGE_BUILD_JOBS` defaults to 2. With no cache override, all build output is temporary.

The runner creates a temporary crate, copies `gpu.rs` into it, rewrites the five Cargo path dependencies to `IRONRDP_CHECKOUT`, and removes the temporary directory on exit. It never changes the selected checkout, production exports, package files or services. Test results are printed as JSON; any failing assertion produces a nonzero exit code.

The eight cases cover:

1. Missing bridge: zero RGBA copies.
2. Non-callable bridge: zero RGBA copies.
3. Throwing bridge getter: zero RGBA copies and no propagated error.
4. Callable bridge: one lookup, one copy, and exact bitmap arguments.
5. Callable but inactive bridge: bitmap delivery remains enabled.
6. Bootstrap: reset, create, map, bitmap, frame and close retain their order and values.
7. Bridge removal and replacement: the next call observes the current bridge.
8. Throwing callback: existing swallowed-error behavior and later recovery remain intact.

The unavailable-bridge cases guard the measured redundant copy in the CPU fallback. The compatibility cases preserve the existing bridge contract: presence of a callable permits forwarding even before it reports active, and lookup/callback errors remain failed delivery. The two explicit BGRX input pixels in `src/lib.rs` are expected as RGBA bytes with opaque alpha in `test.cjs`.

These checks exercise real WASM forwarding, not browser WebGL rendering, codecs such as AVC444, or end-to-end frame pacing. With the original eager argument construction, four unavailable/removal cases fail; the lazy argument implementation passes all eight.
