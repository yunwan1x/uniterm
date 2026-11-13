# Pinned scrcpy server

- Upstream: https://github.com/Genymobile/scrcpy
- Version: 3.3.4 (client protocol must match)
- Download: https://github.com/Genymobile/scrcpy/releases/download/v3.3.4/scrcpy-server-v3.3.4
- SHA-256: `8588238c9a5a00aa542906b6ec7e6d5541d9ffb9b5d0f6e1bc0e365e2303079e`
- License: Apache-2.0, included as LICENSE.

The server is embedded in the Go worker, pushed into a session-specific file
under /data/local/tmp, and run via authenticated network ADB with a unique scid.
No USB access, adb reverse, host display server, or desktop scrcpy process is used.
