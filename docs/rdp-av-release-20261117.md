# rc.12 audio/video recovery deployment — 2026-11-17

Source revision: `b11fc61b4687ccf91c070be6dbd8b01418e83010`, merged and pushed to `main`.
The [technical report](rdp-av-recovery-20261117.md) describes the five fixes and their regression coverage.

## Router

Deployed at `https://192.168.50.1:18888`. Plugin version and Softcenter metadata: `0.3.0-rc.12`. The settings page fallback label also shows rc.12. Authenticated frontend version: `router-0.3.0-rc.12-b11fc61b`.

Gateway health, administrator login, authenticated session, worker SPA, frontend assets, version and WASM checksum checks passed. The running worker executable matched the release server checksum. All 11 recorded account, connection/config, log and TLS file checksums remained unchanged after validation. The HTTP smoke check did not execute application JavaScript or restore saved tabs.

- Server SHA256: `88dfd23898f7c28e8646fbe323231c73bb037757498c13631530f42e700fb6f9`.
- Unchanged gateway SHA256: `22d3c4d6c805d92661f9b2b1ac7945e9e28f0478174f74928d324a4684c596a5`.
- Package: `router-plugin/output/uniterm-0.3.0-rc.12-b11fc61b-arm64.tar.gz`.
- Package SHA256: `1a553496e0d5782e0b3137e5b26aaaa453d846b98d446de7038aa5c40ed88404`.

The replacement server was copied and verified before stopping the service, then renamed into place with automatic health-check rollback armed. The verified rc.11 server remains on NAS and in the router RAM staging directory. The script required 4 MiB of free-space reserve beyond the staged executable. This procedure does not guarantee recovery from a power interruption during replacement.

## Docker

Published `docker.io/changhui/uniterm:latest`, `linux/amd64`, version `0.3.0-rc.12-b11fc61b`.

- Registry digest: `sha256:ac6e148152b0ab6c2510bc97190f1baf8fc1f14f4d517b7149a1739f4399fd93`.
- Local image ID: `sha256:d21288f1de0bfea1645049f5f3ec2a81b892c04fd5dd08a858985f82d666c071`.
- OCI source revision label: `b11fc61b4687ccf91c070be6dbd8b01418e83010`.

A temporary isolated container passed gateway health, login page, administrator login, authenticated session, worker SPA, static assets, frontend release version and WASM checksum checks. The test container and its anonymous volume were removed. No existing uniTerm application container was found to replace; the separate `uniterm-linux-rdp` test environment was left intact.

The repository Dockerfile was used with base-image download mirrors substituted in an external build file. Its build steps were unchanged. Both releases embed the same `.19` IronRDP WASM, SHA256 `e0f3037514f537d84a8f85e4d4edfc5859c3e8f503cf0fc167705d23be11b9ec`, verified through authenticated HTTP responses from each production artifact. No SIMD experiment was included.

## Validation and limits

The combined audio/video/session regression suite passed 99 tests, and the actual-WASM bridge fixture passed 10 checks. Real Chromium testing showed that an isolated 100 ms sound now produces output without waiting for RDPSND Close. The ARM64 server passed UPX integrity checking, and its package passed gzip integrity checking. Router and Docker production builds passed. Full frontend type checking retains the same 567 baseline diagnostics, identical after normalizing the workspace path; it is not a clean typecheck.

This release does not establish the cause of the original intermittent Windows audio loss or claim to reproduce every issue in a live Windows RDP session. Refresh the browser and reconnect remote sessions to load the new frontend and workers.

Build, smoke-test and regression evidence and rc.11 backup: `/vol1/1000/wy/uniterm-rc12-release-20261117/` on NAS. Router staging and rollback copy: `/tmp/uniterm-rc12-install.20261117/` (volatile across reboot).
