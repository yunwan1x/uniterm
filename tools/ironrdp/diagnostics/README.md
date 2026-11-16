# Isolated RDP flow diagnostics

These opt-in hooks accompany the frontend tracing code on
`experiment/rdp-simd-client-20261115`. This is an experimental branch with
snapshot experiments in its ancestry; it is not a production release or a
replacement for `main`. The frontend dependency remains `uniterm.17` by default.

`flow.patch` is the diagnostic-only change to
`crates/ironrdp-web/src/session.rs`. It records stage/loop/queue metadata through
an optional JavaScript callback. It does not change ACK contents or policy.
`contract.json` defines the event meanings, separate identity namespaces,
bounded buffers, opt-in switches and validity limits. No payloads, credentials,
screen captures or private test configuration are included here.

## Reconstruct the reviewed Rust source

Start with a separate clean IronRDP checkout at
`905c28b3a4e67b15fac274c5d808ef3cef0eb813`. Apply this repository's complete
baseline customization first, then this incremental patch:

```sh
uniterm_repo=/absolute/path/to/this/uniterm-checkout
cd /absolute/path/to/disposable/IronRDP-checkout
git checkout --detach 905c28b3a4e67b15fac274c5d808ef3cef0eb813
git apply --check "$uniterm_repo/tools/ironrdp/patches/uniterm.patch"
git apply "$uniterm_repo/tools/ironrdp/patches/uniterm.patch"
git apply --check "$uniterm_repo/tools/ironrdp/diagnostics/flow.patch"
git apply "$uniterm_repo/tools/ironrdp/diagnostics/flow.patch"
```

Expected SHA256 values:

| Input or output | SHA256 |
| --- | --- |
| Baseline `patches/uniterm.patch` | `a4c3e3f9a0f78226ccbd16f33a1b1d962dccf016110f830e32485f9e39ca5fe5` |
| Incremental `flow.patch` | `888a29d206e6539a9e485722b9e15a667ddb0ef87b80577120c9689f416cd343` |
| Patched `session.rs` | `5f531f0edd1e963f88bcfa3f1799ef4c3aced1c992f12f391bcb569e00e87047` |

Build the patched engine separately using Rust 1.99.1, the
`wasm32-unknown-unknown` target and wasm-bindgen 0.2.129. The recorded diagnostic
build used the release profile without SIMD, with the `wasm_js` getrandom
backend. Generate the JavaScript bindings and WASM together; do not swap only
the WASM into unrelated bindings. Name any packaged result as a diagnostic
artifact and install it only in a disposable frontend checkout. The standard
production `build.sh` does not apply this extra patch.

The archived tested artifact was `0.5.1-uniterm.diagnostic1`, with WASM SHA256
`58ec511178cd0e223ecb8118a273bce4e5b679f5430eb8c961d1e61bdb8b0a04`
and tarball SHA256
`54ebc286583e1dbf96e2e601d385d2c66a10e5457ec4510d1f4a6922419cd1b8`.
Its original build procedure and provenance remain in the NAS evidence archive
identified by `main:docs/rdp-simd-20261116.md`.

## Enable only for a diagnostic session

Before reconnecting, enable both `uniterm.rdp.presentationTrace=1` and
`uniterm.rdp.flowTrace=1` in the client origin's local storage. Both default off.
The callback is cached when the Rust session is created. A valid capture must
have zero Worker/main drops, contiguous drains and complete in-phase lifecycles.

The first captured flow overflowed and cannot explain stalls. The one bounded
repeat retained 99,509 events, with no drops or drain gaps, and had a maximum
draw-submission gap of 99.715 ms. It did not reproduce the earlier >100 ms gaps
and did not establish their cause. Enabled tracing adds overhead and its timings
must not be pooled into the release SIMD comparison.

`response-enqueued` is a generic writer-queue event, not a parsed protocol ACK or
proof of server receipt. Local display ACKs are separate from protocol ACKs;
WebSocket delivery is not wire arrival. See the contract before interpreting
timing spans or correlating independent identifiers.
