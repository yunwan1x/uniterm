# Upstream integration verification — 2026-11-19

Base: `498dd6e032eb71d9849a839314e4c71eb7121640`.
Upstream: `03b4752f` (`ys-ll/uniterm`, main), 26 upstream-only commits.
Branch: `preview/upstream-20261119`.

## Resolutions

- Keep both the local adb-go replacement and the upstream utls replacement.
- Preserve custom translation keys alongside upstream translations.
- Package IronRDP as `0.5.3-uniterm.24`, incorporating upstream certificate,
  licensing, and connector fixes while retaining custom channel-aware
  reactivation, image clipboard, audio, rendering, and capture support.
- Retain CredSSP stage and length diagnostics without logging raw authentication
  records.

## Validation

- Frontend: 169 tests passed across clipboard, geometry, zoom, session lifecycle,
  audio, keyboard shortcuts, and Zmodem.
- Go: backend/firewall, backend/session, and backend/store tests passed.
- Rust: ironrdp-connector (10), ironrdp-rdpsec (4), and ironrdp-session (50)
  library tests passed.
- Wails bindings generation, Vite production build, Go server production build,
  and WASM release build passed.
- No unresolved Git conflicts; diff whitespace checks passed.

Windows and xrdp live connection/clipboard tests were not rerun for this merged
revision. Passing unit tests and builds do not establish live protocol compatibility.
No remote branch, Docker image, or running deployment was updated.
