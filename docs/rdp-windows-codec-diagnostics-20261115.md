# Windows RDP codec diagnosis

The user confirmed that the affected router web client connects to the Windows
11 machine reachable at 192.168.200.1 / 192.168.50.66. This follow-up investigates
that host rather than extrapolating the earlier isolated xrdp measurements.

## Host evidence

At 18:28–18:34 +08 on 2026-11-15, WTS enumeration showed session 1 disconnected,
the console connected, and the RDP listener listening. No established TCP 3389
connection or RemoteFX Graphics/Network counter instance was present. A bounded
four-minute instance watcher also ended without collecting samples. Empty
counter results do not establish server, network or client performance.

The host has AVCHardwareEncodePreferred=1 and AVC444ModePreferred=1. Hardware
rendering/WDDM override policies and DWMFRAMEINTERVAL are not configured. No host
policies were changed.

RdpCoreTS events correlated by ActivityID:

| Connection time (+08) | Router source port | Event 162 | Event 170 | Desktop |
|---|---:|---|---|---|
| 18:16:09 | 46998 | Version 0xA0701, AVC available 1, initial profile 2048 | Intel Quick Sync H.264 encoder enabled | 3024×1702 |
| 18:19:18 | 54308 | Version 0x80105, AVC available 0, initial profile 2 | No corresponding event | 2992×1374 |

The latter connection matches the production uniTerm log: client start at
18:19:12.981, GFX/high/adaptive, 2992×1374, securityMode=nla-prefer; TCP endpoint
192.168.50.1:54308 disconnected at 18:26:39.086. No frontend renderer/AVC fallback
error was logged for this attempt. The first connection's application identity
was not established from its shared router source address.

Microsoft documents AVC available 1 plus initial profile 2048 as affirmative
AVC444 evidence, with event 170 confirming hardware encoding. Its absence does
not establish that all H.264/AVC420 decoding was disabled. Current uniTerm
capabilities distinguish no decoder (V8), decoder without readable YUV planes
(V8.1 with AVC420 plus V8), and decoder with YUV support (including V10.x).
Thus the newer event is consistent with a reduced-capability path, but it does
not identify the browser-side cause or prove the actual wire codec. The initial
server capability confirmation is permissive in the current engine; confirmed
versions alone cannot conclusively reconstruct the offered capability list.

## Missing browser evidence

The existing startup path silently returns without AVC when isolation, shared
memory or VideoDecoder is unavailable, or when the nested decoder worker fails
or exceeds its three-second initialization deadline. Baseline H.264 support,
high-profile support and a real decoded-picture YUV readback probe also affect
the capabilities offered. Without those results, changing Windows policy or
forcing an advertised codec would be speculative.

Production HTTPS responses for both `/` and `/login` include
Cross-Origin-Opener-Policy: same-origin and
Cross-Origin-Embedder-Policy: credentialless. That verifies server headers, not
the user's actual browser secure-context or crossOriginIsolated values.

The next reproduction needs startup capability/probe outcomes, actual decoded
AVC and GPU AVC420/444 observations, and simultaneous Windows Input/Output FPS,
encoding time and skipped-frame counters. The user was asked to reconnect in
the router webpage and play video or scroll for about thirty seconds, and to
identify the client device/browser. No active reproduction was captured yet.

## Implemented diagnostics

Each client attempt now records its build/asset identity, worker versus main
thread selection, secure-context/isolation/API prerequisites, and existing
fallback flags. The protocol worker reports GPU availability and the AVC init
result, elapsed time, baseline codec query result and YUV/high-profile probe
result. A probe-construction failure still disables AVC, with an explicit
failure result instead of waiting for the outer timeout. Codec capabilities,
timeouts, decoding, frame ordering and presentation policy are otherwise
unchanged. No WASM rebuild is required.

The existing one-second stats message emits at most three positive observations
per session: first successful AVC picture, first GPU AVC420 conversion, and
first GPU AVC444 conversion. An AVC picture is not a displayed frame. Zero GPU
YUV counts do not rule out RGBA AVC420. There is no per-frame log, credential,
clipboard content or remote desktop content in these records.

The RDP worker/renderer/audio suite passes all 60 tests in ten files, including
17 new cases covering startup failures, capability outcomes, callback isolation
and one-time codec observations. Targeted TypeScript checking passes for the
three changed TypeScript modules. Independent review found no remaining
blocking issue.

## Router delivery

Code commit: `723d91b4b7b29d56b9585385f50ee185383fd80b`.
The Vite production build and ARM64 server build completed successfully; UPX
integrity verification passed. The installed server SHA256 matches the build:
`fe0ee9c52a49fd85c024950ef49629a24ae9e9c9e9db4f8f0fa759c64acc82e5`.
The gateway binary is unchanged. Production `/health` reports OK after restart.
No active connection to the affected Windows host was present during delivery.

The NAS retains `uniterm-0.3.0-rc.6-723d91b4-arm64.tar.gz` (15,559,660 bytes),
SHA256 `45c4133b18672c67d54b73d0bbb8517baf8c015b154ee528597fb588f2c5188e`.
The rc.5 package is retained for rollback. Package metadata records
`router-0.3.0-rc.6-rdp-diag-723d91b4`; the installer/gateway are reused from rc.5.

A second bounded five-minute Windows watcher also ended with no active counter
instance. No active reproduction had been captured by 18:43 +08. The deployment
check establishes the installed binary and gateway health, not a new live RDP
performance measurement. Reload/reconnect the browser to load the diagnostic
assets; Windows sampling must be restarted alongside the next reproduction.

## References

- [Microsoft AVC/H.264 event interpretation](https://techcommunity.microsoft.com/blog/microsoft-security-blog/remote-desktop-protocol-rdp-10-avch-264-improvements-in-windows-10-and-windows-s/249588)
- [Microsoft graphics performance counters](https://learn.microsoft.com/en-us/azure/virtual-desktop/remotefx-graphics-performance-counters)
- [Microsoft GPU acceleration verification](https://learn.microsoft.com/en-us/azure/virtual-desktop/graphics-enable-gpu-acceleration)
- [Microsoft graphics policy definitions](https://learn.microsoft.com/en-us/windows/client-management/mdm/policy-csp-admx-terminalserver#ts_dx_use_full_hwgpu)

These findings do not establish a new frame-rate improvement or resolve the
remaining long stalls. The previously deployed GPU synchronization fix remains
the performance baseline.
