# Upstream merge validation — 2026-11-19

Integrated upstream `03b4752f` through merge `fa434a82`, preserving the custom
Android, RDP clipboard, audio, rendering, and resize behavior.

## Fixes found during validation

- Corrected upstream Standard RDP Security X.509 parsing: use the declared
  certificate count, read padding after the whole chain, and avoid removing
  the first RSA DER byte after the BIT STRING API already removed its header.
  The new valid-chain test failed with `CertTruncated` before the fix.
- Added independently generated certificate/ciphertext fixtures plus truncated
  input, count-bound, and temporary-certificate regression cases. The shipped
  engine is `0.5.3-uniterm.25`; its complete source patch applies to the pinned
  base without conflicts.
- Corrected the new AI add-menu event typing and used the complete tab union,
  with a panel-presence guard for transfer indicators.
- Isolated sync tests from the real OS keyring, fixed the highlighter test's
  clock, and retained full-byte file checks using a fast byte comparison.

## Passing checks

- Frontend: all 130 test files / 1417 tests; final focused regression: 155 tests.
- Go: `CGO_ENABLED=0 go test -tags server ./...`, including firewall, sessions,
  settings, sync, local servers, and gateway.
- Rust: connector/rdpsec/session library tests (64), audio tests (160), and
  new X.509 tests (4).
- Production Vite, Linux server, WASM release, and Windows desktop cross-build.
- Docker amd64 build, health endpoint, admin login, authenticated frontend,
  and exact packaged WASM hash check.
- Live xrdp GFX: 12 zoom changes with compatibility disabled and 12 enabled,
  with increasing audio packet counts after every change and no decode errors.
  Both modes finished at 581 audio packets, with reconnect between test runs.
- Browser: double-Ctrl AI sidebar toggle in both directions, no runtime exceptions.
- Live xrdp: images both directions with pixel verification, no clipboard echo,
  text after images, native Ctrl+V without Clipboard.read, and actual image
  receipt by a GTK application.

The initial native-paste failures came from the dedicated QA desktop's lock
screen. X11 ownership inspection identified `xfce4-screensaver-dialog` clearing
the clipboard. After disabling the test account's screensaver, the original
pixel assertions and the stronger GTK receiver check passed. No clipboard
production code was changed to hide that failure.

## Limits

The repository-wide TypeScript check still fails on pre-existing diagnostics.
Compared with the pre-merge check, normalized diagnostics show no new errors;
the changed UI removes several existing ones. This is not a clean typecheck.

No Windows RDP server was available for live interoperability testing. Certificate
fixtures and a Windows desktop build do not replace that test. Firewall parsing
and SSH-access guards were covered by tests; live host firewall rules were not
changed. Docker was built and smoke-tested locally, not published or deployed.

## Repeat live checks

Use a dedicated, unlocked xrdp test account. The JSON credentials file supplies
`username`, `password`, and the test gateway's `adminPassword`. Set
`RDP_CREDENTIALS_FILE`, `UNITERM_TEST_URL`, and optionally `PLAYWRIGHT_MODULE`.
Run `tools/ironrdp/live/image-clipboard.mjs` and
`tools/ironrdp/live/resize-audio.mjs`; repeat the latter with `RDP_COMPAT=1`.
The image check requires xclip, xdotool, Python GTK bindings and Pillow;
the resize check requires PulseAudio and paplay in the remote test desktop.
