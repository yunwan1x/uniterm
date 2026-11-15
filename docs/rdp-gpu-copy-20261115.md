# Canvas2D fallback GPU bridge copies

The NAS Chromium Canvas2D client still invokes the Web graphics handler after
the CPU compositor has applied an EGFX bitmap. In uniterm.16, the `call!` macro
constructed its JavaScript arguments, including an RGBA `Uint8Array` copy,
before `command()` discovered that no `unitermGpuCommand` function existed.
The array was unused in this path.

A separate 15-second Win11 scrolling CPU profile attributed 10.88% of valid V8
sample weight to the typed-array copy import. Almost all of that weight had the
`handle_wire_to_surface1` / `process_pending_graphics` ancestor stack. Sample
weights are not precise CPU timers. The profile identifies removable work; it
does not imply an equivalent end-to-end throughput increase.

## Change

`0.5.1-uniterm.17` passes a lazy argument closure to `command()`. It resolves and
validates the JavaScript function first, then constructs arguments exactly once
and invokes that function. A registered but inactive GPU bridge still receives
bootstrap commands such as reset/create/map. The check does not cache function
availability, so removal and replacement take effect on the next command.
Lookup and callback exceptions retain the previous optional-result behavior.

Only `crates/ironrdp-web/src/gpu.rs` differs from the complete 25-file uniterm.16
IronRDP patch. The production TypeScript presentation mechanism is unchanged.
The multi-region snapshot experiment remains on its separate branch because it
did not produce multi-region batches in live testing.

## Correctness and reproducibility

The real-WASM fixture sends explicit uncompressed EGFX PDUs through
`GraphicsPipelineClient.process` into the actual Web handler. A JavaScript
typed-array constructor proxy observes RGBA copying; fixed expected pixel bytes,
rectangles and command sequences check forwarding behavior.

The baseline fails four of eight checks: missing bridge, non-callable bridge,
throwing lookup, and bridge removal. The candidate passes all eight, including
inactive callable delivery, bootstrap ordering, single lookup and exception
recovery. The portable runner in `tools/ironrdp/gpu-bridge-regression/` was also
executed successfully. Its dependency versions, sources and checksums match the
fork's lockfile. These tests validate WASM forwarding, not a physical WebGL
driver or AVC codec output.

The complete production WASM release build passed. Its JavaScript executable
glue is identical to uniterm.16; seven generated `shim_idx` comments differ.
Both TypeScript declaration files are byte-identical. The combined patch applies
to a clean index of the pinned IronRDP base, and all 25 resulting source files
match the build inputs. Existing whitespace warnings in the inherited patch are
unchanged. The original dirty IronRDP checkout was not modified.

## Live comparison

The isolated NAS browser connects to Win11 at actual 1920x1080. Both variants
use the same diagnostic JavaScript source,
one presentation buffer and region budget one. Runtime asset names and full
WASM hashes are checked outside every measurement phase. Profiling and builds
are disabled during the pacing comparison. Each workload runs A-B-B-A, 30 seconds
per round; all metrics are independently recomputed from raw events.

The completed scrolling comparison measured 28.513 submissions/s on baseline
and 31.703 on candidate (+11.19%). P95 intervals fell from 67.46 to 61.14 ms;
P99 fell from 80.95 to 70.72 ms. Both candidate rounds had lower P95 and P99
than both baseline rounds. The source updated at 31.98–32.02/s in all four
rounds; mean screenshot area differed by only -0.00155%. These are JavaScript
display submissions, not physical display FPS or distinct source frames.
All eight rounds passed: 7,425 complete display batches, no page errors,
no trace overflow or discarded snapshots, and at most one batch in flight.
Both builds retained AVC/YUV availability with software Canvas2D throughout.

| Workload/build | Submissions/s | Gap P95 | Gap P99 | Maximum | Gaps >100 ms |
| --- | ---: | ---: | ---: | ---: | ---: |
| Scroll, baseline | 28.51 | 67.46 ms | 80.95 ms | 100.68 ms | 1 |
| Scroll, candidate | 31.70 | 61.14 ms | 70.72 ms | 94.15 ms | 0 |
| Video, baseline | 30.62 | 60.41 ms | 105.79 ms | 206.23 ms | 21 |
| Video, candidate | 32.59 | 57.46 ms | 77.35 ms | 132.64 ms | 7 |

Video varied substantially within the same build. In chronological A1/B1/B2/A2,
the numbers of gaps above 100 ms were 0/6/1/21 and P99 was
66.50/79.64/75.59/140.72 ms. Thus B1 was worse than A1, while the later baseline
was worse than both candidates. The pooled +6.45% submission rate and lower tail
do not establish a stable video speedup or elimination of rare stalls.
Source video callbacks were 16.57–17.44/s with approximately 250 ms P99 gaps;
source dropped-frame increments were 23/9/4/13. This looping clip is not an
ideal constant-rate source or a denominator for client frame loss.

All six B1 gaps above 100 ms were inspected. The prior local ACK reached the
Worker in 0.070–0.140 ms, with no unfinished recorded snapshot/decode promise.
The next decode-start came 46.04–109.93 ms after that ACK; next damage came
93.06–128.82 ms later. Once damage arrived, snapshots took 2.85–3.09 ms and
ready-to-draw took 0.62–0.76 ms. These examples do not show a ready picture held
by the presentation queue or a long local ACK delay. The uninstrumented interval
is not proof of idleness: network receives, every WASM command and OS scheduling
were not traced. It cannot be assigned to Windows/network or exclude indirect
pacing effects.

Candidate screenshots retain the expected text, chart and video regions without
obvious missing blocks or color corruption. Existing Windows taskbar and monitor
overlays were left untouched. These visual checks are not pixel-perfect live
oracles. The source remained at 1920x1080 and the same saved clip was used.

The shipping decision accepts the deterministic removal of unused work and
consistent scrolling improvement, with no consistent video regression across
this small comparison. Video variability and occasional long intervals remain
unresolved. This does not add interpolation, drop protocol frames, or change
presentation-buffer count. A separate candidate CPU profile is reviewed below.

## Targeted CPU follow-up

The original uniterm.16 scrolling profile contained 1,407 target-stack samples
out of 12,089. The independent uniterm.17 profile contained zero target-stack
samples out of 11,775, while 5,248 samples still had `handle_wire_to_surface1`
in their ancestry. Fourteen other typed-array copy samples remained: thirteen
in `webcodecs::prepare` and one in `WebSocket::start_send`. The classification
uses the complete stack, so unrelated required copies are not mislabeled.
Together with the real-WASM regression, this supports removal of the targeted
unused copy rather than absence of graphics work.

The candidate raw profile contains one negative delta: `timeDeltas[1424] = -1`
microsecond on a `(program)` sample, causing a local 1 microsecond cumulative
reversal. It has no zero deltas. The raw data is retained unchanged; candidate
sample-weight fields are null and no exact CPU percentage reduction is inferred.
The profile duration is about 15.2 seconds and the target result uses counts,
not adjusted timing. The separate diagnostic presentation run still had a
103.375 ms maximum interval. Remaining sampled work includes color conversion,
`createImageBitmap`, composition and framebuffer extraction/copying.

## Artifact identity

- IronRDP base: `905c28b3a4e67b15fac274c5d808ef3cef0eb813`.
- GPU handler SHA256: `7c44e95988b8cc63f471bb3ee559574f39440ea25cfb1e5f943bcec7f9c33cb2`.
- WASM SHA256: `09408b5f7617725c0163e6eb4556146a058f5815a5310e184b61f2b21bc62e8d` (8,746,979 bytes).
- Vendor tarball SHA256: `ce7f35ea3b97b12bc93572e940c9769596a223170d9c3f06ec573afac622f045`.
- Combined patch SHA256: `a4c3e3f9a0f78226ccbd16f33a1b1d962dccf016110f830e32485f9e39ca5fe5`.
- Candidate package commit: `b7a10d3db10dd92b440d70d68e2b4d2b8bf2520b`.

The package-only change was cherry-picked onto production `main` as
`65a5f700ab5ad063eb9f5a3e573924435ddb5701`. No experimental TypeScript files were
included. The ARM64 release build and UPX integrity check passed. Production installation
verified rc.7/new server hashes, retained the gateway, replaced the binary
atomically, restarted the service and passed the HTTPS health check. The
installer passed sixteen local mocked failure cases, including startup/health
failure, TERM/HUP, integrity rejection and an explicitly reported recovery failure.
The router lacks `mktemp`; staging used an exclusively created unique directory.
No production change occurred during that initial staging preflight failure.

- Version: `router-0.3.0-rc.8-gpu-copy-65a5f700`.
- Installed server SHA256: `27991dbd0033d59adf445ce7f40e24c19db616f2d27995af71f17a38bc76ce45`.
- Unchanged gateway SHA256: `22d3c4d6c805d92661f9b2b1ac7945e9e28f0478174f74928d324a4684c596a5`.
- Release: `router-plugin/output/uniterm-0.3.0-rc.8-65a5f700-arm64.tar.gz`.
- Release SHA256: `e3ac137fe8883423677216e6869dc2563fc0cf5dad0ec835314b73f7cbe6ab34` (15,564,472 bytes).
- Retained rollback: `uniterm-0.3.0-rc.7-31db2ef0-arm64.tar.gz`, SHA256 `b7c3a2d74d5070b5adc8f73113121d01a4e9c63cd21f2176ec76734ad4c98b01`.

The owned NAS browser connected through the production origin
`https://192.168.50.1:18888` and verified the actual WASM URL and full SHA256 at
start/end. Secure context and cross-origin isolation remained enabled. Scrolling
and video each passed at actual 1920x1080 Canvas2D: source/display counters
advanced, both F8 key checks reached the source, and no page errors occurred.
Production screenshots show the expected text, charts and video without obvious
missing regions or color corruption. This short functional acceptance is not a
second paired performance benchmark and did not exercise audio playback.

No claim of eliminating all stutter follows from removing this redundant copy.


## Evidence and cleanup

Raw baseline/candidate captures, CPU profiles, pixel replay, regression sources,
review notes, manifests and production acceptance are retained in
`rdp-snapshot-gpu-copy-evidence-20261115.tar.gz` under
`/vol1/1000/wy/uniterm-rdp-evidence/`, with an adjacent SHA256 checksum file.
This archive includes the rejected snapshot experiment, so its negative result
and remaining diagnostics are retained alongside the accepted change.

All owned test browsers, the Win11 fixture/task, relays/tunnel and isolated
NAS gateway were stopped after ownership checks. Their private config/TLS and
temporary binaries were removed. Both temporary login files were deleted;
632 evidence-directory files were scanned for the exact current password bytes
with zero matches, without recording the value. The production staging and
build directories were removed after verifying the retained release package.
Production health and installed hashes were rechecked. Other applications and
the production gateway remain unchanged. Source experiment branches and the
rc.7 rollback package are retained.
