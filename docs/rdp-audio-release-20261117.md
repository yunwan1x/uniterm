# rc.11 audio recovery deployment — 2026-11-17

Audio recovery fix: `90c773ba`. Binary source and Docker revision: `1fdf69d7392d76bf76fb0195504cfe567ef62611`.
The router settings page fallback label is updated to rc.11 alongside this deployment record; this external ASP page is not embedded in either binary.

## Router

Deployed at `https://192.168.50.1:18888`. Plugin version: `0.3.0-rc.11`; authenticated frontend version: `router-0.3.0-rc.11-1fdf69d7`.
The running worker executable SHA256 matches the new server. Gateway health and authenticated frontend asset/version checks passed. All 11 account, connection state/config and TLS file checksums remained unchanged, including after HTTP validation. No application JavaScript or restore-tabs workflow was executed by the smoke check.

Server SHA256: `f4376402f6eb7a03b92b6c2da0466db52e2d183122816849b3542b61fc5a248e`.
Unchanged gateway SHA256: `22d3c4d6c805d92661f9b2b1ac7945e9e28f0478174f74928d324a4684c596a5`.
Package: `router-plugin/output/uniterm-0.3.0-rc.11-1fdf69d7-arm64.tar.gz`.
Package SHA256: `954743ea16bb6d673f909d8b1dd358e9e6bfb22659d99a901647ac007d9c0045`.

The existing low-space replacement procedure was reused with updated expected hashes/version. Verified previous-server backups were retained on NAS and router RAM before stopping the service. Automatic health-check rollback was armed during replacement. This procedure does not guarantee recovery from power loss during the replacement window.

## Docker

Published `docker.io/changhui/uniterm:latest`, `linux/amd64`, version `0.3.0-rc.11-1fdf69d7`.
Digest: `sha256:be368e466c9512b7fae9eaaebc0db2e90e161b82f77553ba947e6169d0c4b1d5`.
Local image ID: `sha256:6141e03d086232bfaf6dce2f16ae897480c89756cb68bde3a9b700f5e011b0e5`.
Docker frontend builds now receive the VERSION argument, avoiding an unversioned About screen.

A temporary isolated container passed gateway health, login page, initial administrator login, authenticated session, worker SPA, static assets and frontend release-version checks. Container and anonymous volume were removed after testing. No existing uniTerm application container was found or replaced; the separate uniterm-linux-rdp test environment was left intact.

## Validation and limits

The audio fix passed 25 unit tests and real Chromium processor-crash recovery checks, documented in `rdp-audio-recovery-20261117.md`. Router and Docker production builds passed; the ARM64 server passed UPX integrity checking and the package passed gzip integrity checking. Full frontend type checking still has the same 567 baseline diagnostic locations/codes.

This deployment does not establish that the previously reported intermittent Windows audio loss was caused by the repaired browser failure. Reproduction of that original Windows incident remains outstanding.
Evidence, build logs and backups: `/vol1/1000/wy/uniterm-audio-release-20261117/` on NAS. Refresh the browser and reconnect existing remote sessions to load the new frontend.
