# Network Android / redroid verification

Android sessions use the embedded Go ADB client and scrcpy. Neither the runtime
image nor native builds require an external `adb`, Python, or an ADB server.
Existing HOME/.android/adbkey identities are reused; each user worker has its
own key. Pairing codes stay in memory and are excluded from library logs.
`UNITERM_ADB_BIN` is no longer a runtime setting. External adb is optional only
for older host-side test helpers that explicitly invoke it.

For an isolated Linux redroid fixture (requires binder kernel support):

```sh
docker run -d --name uniterm-redroid-test --privileged \
  -p 127.0.0.1:15555:5555 redroid/redroid:12.0.0-latest \
  androidboot.redroid_width=720 androidboot.redroid_height=1280 \
  androidboot.redroid_gpu_mode=guest androidboot.use_memfd=1
UNITERM_ANDROID_LIVE=1 \
  CGO_ENABLED=0 go test -tags "server production" ./backend/session -run TestAndroid -v
```

The live test is opt-in and connects only to the local fixture on 15555. It checks
immediate startup, actual H.264 packets, a control packet, binary file round trip,
invalid/missing download paths, and unregistering the proxy on disconnect.
The live test clears PATH to verify that no adb binary is used. Other tests cover
control serialization, key persistence/isolation, pairing validation and stream
cancellation. The media/isolation test additionally needs the existing
/sdcard/Download/uniterm-bbb-clip.mp4 fixture.

UI checks: create Android under Remote Desktop, connect to 127.0.0.1:15555,
click/drag the screen, Home/Back/Recent, rotate an activity that allows rotation,
run `printf uniterm-shell-ok`, and upload/download a binary with a Unicode name.
Use HTTPS or localhost for WebCodecs. The software H.264 decoder is selected when
WebCodecs is unavailable. A browser interaction activates audio playback.

Redroid has no real Wi-Fi network: Android 12 logs “Not connected to any wireless
network. Not enabling adbwifi.” It validates network ADB, not physical Wi-Fi pairing.
Validate successful six-digit pairing on an Android 11+ phone before claiming it
has passed device testing. Pairing and connection ports are different and may change.

Docker's localhost is the container: use the Android device's reachable LAN IP or
a redroid service name on a shared Docker network. Do not publish unprotected
redroid ADB on a public interface.

## Automated Docker browser check

Install Playwright for the scripts (and its Chromium browser). Run with a private
JSON credentials file containing `username` and `password`:

```sh
UNITERM_TEST_CREDENTIALS=/private/test-credentials.json \
UNITERM_TEST_URL=http://127.0.0.1:18091 \
ANDROID_HOST=172.17.0.2 ANDROID_PORT=5555 \
REDROID_CONTAINER=uniterm-redroid-test node tools/android/docker-live.mjs
```

This test STOPS AND RESTARTS the named redroid container. Use a disposable test
instance. It records screenshots, logs to stdout, and a video under /tmp.
The Gallery pointer assertion assumes the standard redroid 720×1280 launcher.
`browser-live.mjs` is an additional CDP-attached check for the local 15555 fixture.

## Floating window verification

With redroid running and a test uniTerm gateway, use:

```sh
UNITERM_TEST_CREDENTIALS=/private/test-credentials.json \
UNITERM_TEST_URL=http://127.0.0.1:18092 \
ANDROID_HOST=127.0.0.1 ANDROID_PORT=15555 \
REDROID_CONTAINER=uniterm-redroid-test node tools/android/pip-live.mjs
```

Requires Chromium with Document Picture-in-Picture enabled and a secure context
(localhost is suitable). Exercises a real native PiP window, native close,
interactive redroid input, switching tabs, local fallback drag/resize,
fullscreen, policy rejection, same-canvas preservation and connection-tab cleanup.
It forces the API absent/denied after the native test to exercise fallback paths.
Screenshots/video and the video-path manifest are written under /tmp/uniterm-pip*.
The test creates and closes its own Android connection tab.
