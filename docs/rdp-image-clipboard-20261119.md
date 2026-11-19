# RDP image clipboard

UniTerm sends local clipboard images as PNG through IronRDP and writes remote
images through the browser/WebView Clipboard API. Native paste events accept
PNG, JPEG, WebP and BMP and normalize them to PNG. Native file copies keep their
file-transfer semantics, including when the copied file is a PNG.

Images are normalized in both directions before comparing clipboard contents,
so OS PNG re-encoding does not continuously echo a remote image back. Images
are limited to 16 MiB of encoded data and 16 megapixels. Clipboard-read permission
prompts time out without blocking subsequent paste input. A failed native image
paste never sends Ctrl+V using the previous clipboard contents.

The vendored IronRDP bundle is `0.5.2-uniterm.23`. It offers CF_DIB as well as
CF_DIBV5 and PNG. xrdp requires CF_DIB to expose image/bmp to Linux applications.
In the other direction, xrdp advertises CF_DIBV5 but rejects requests for it;
UniTerm now falls back to CF_DIB. Peers with working DIBV5 retain that preferred
format. No new encoder or external runtime dependency is required.

## Validation

- 37 clipboard synchronization, image-boundary, browser-file and file-transfer
  unit tests passed.
- Targeted TypeScript checking for the clipboard utilities passed.
- Vite production frontend, headless Go worker and Rust WASM builds passed.
- The combined IronRDP patch reverse-applies cleanly to its build tree.
- Real Chromium + xrdp tests verified local-to-remote and remote-to-local image
  dimensions and RGB pixels, no remote-image echo across polling, text paste
  after image copy, and Ctrl+V image paste with Clipboard.read unavailable.
- Full project typechecking has errors in other modules, recorded in
  `/tmp/uniterm-image-typecheck.log`; none referred to the changed clipboard
  modules or RDPTabContent.vue.

Windows server and native desktop WebView end-to-end testing were not available.
The browser/WebView must support image clipboard writes and permit clipboard
access; browsers generally require HTTPS or localhost. A real paste event can
send images even when programmatic reads are unavailable. CF_DIB does not retain
alpha; PNG/DIBV5 remains available for peers that support it.

## Reproduce the live test

Use a dedicated local xrdp/Xfce test account. The driver changes that account's
clipboard. Install Playwright, xclip and Python Pillow; run the driver as a user
allowed to use runuser for the test account. Supply a private JSON credentials
file with `username`, `password`, and `adminPassword` for the isolated UniTerm
server. Never commit credentials.

```sh
UNITERM_TEST_URL=http://127.0.0.1:18119 \
RDP_CREDENTIALS_FILE=/path/to/private-credentials.json \
RDP_ARTIFACT_DIR=/tmp/uniterm-image-clipboard \
node tools/ironrdp/live/image-clipboard.mjs
```

Set PLAYWRIGHT_MODULE to an installed Playwright module path if it is not
resolvable through Node's normal package lookup. The xrdp server is expected
on localhost:3389. BMP artifacts and a session screenshot are saved in the
artifact directory.
