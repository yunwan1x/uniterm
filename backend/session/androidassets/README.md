# Pinned scrcpy server

- Upstream: https://github.com/Genymobile/scrcpy
- Version: 3.3.4 (client protocol must match)
- Download: https://github.com/Genymobile/scrcpy/releases/download/v3.3.4/scrcpy-server-v3.3.4
- SHA-256: `8588238c9a5a00aa542906b6ec7e6d5541d9ffb9b5d0f6e1bc0e365e2303079e`
- License: Apache-2.0, included as LICENSE.

The server is embedded in the Go worker, pushed into a session-specific file
under /data/local/tmp, and run via authenticated network ADB with a unique scid.
No USB access, adb reverse, host display server, or desktop scrcpy process is used.

## uniTerm dynamic bitrate extension

The embedded jar is now built from v3.3.4 with `dynamic-bitrate.patch` and the image clipboard helper in `clipboard/`. Current SHA-256:
`d245e0cf3ed96f19ce8dddd083f58299c8a14698b0b2b217b29da5908c098afa`.
Rebuild using `ANDROID_HOME=... ./build-dynamic-bitrate.sh` (SDK/build tools 36,
JDK, git). The patch and upstream Apache-2.0 license are shipped here.

Private control message 100: one big-endian uint32 bitrate, 500000–40000000.
Private device message 100: signed big-endian int32, positive accepted bitrate or
negative rejected bitrate. MediaCodec.setParameters changes bitrate without
restarting capture. The codec lifecycle lock prevents races with rotation/reset;
the selected bitrate is retained across capture resets. An acknowledgement means
the codec accepted the request, not a guarantee of exact output bandwidth.

The matching Go proxy parses normal clipboard/ACK/UHID messages as well, and
forwards quality acknowledgements separately from video metadata. Browser auto
mode stops adapting on rejection or acknowledgement timeout, preserving the live
session. Stock scrcpy servers do not support this extension.

## Android clipboard

Text paste uses the scrcpy control connection and accepts up to 128 KiB of UTF-8.
On Android 10 and later, an explicit browser paste or toolbar action can send a
PNG or JPEG of up to 16 MiB. The worker stages the helper for the request and
launches it with app_process under the authorized ADB shell. The helper stores
the image in Pictures/uniTerm and puts its MediaStore URI and MIME type on the
system clipboard. The image remains in the gallery until the user removes it.
Pasting into an app requires that app to accept image content.
