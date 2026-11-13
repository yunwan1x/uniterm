# RDP floating and independent windows

The RDP status bar now provides icon buttons for Floating window and Independent
window. Both move the existing canvas and session into the destination document.
The child has no uniTerm status bar, fullscreen toolbar, keyboard or file panel.
The original tab provides Restore and Focus floating window. Closing the child
returns the same view to the original tab.

Document Picture-in-Picture is used where available in a secure context. Otherwise
it falls back to an in-page window with a thin drag edge and bottom-right resize
handle. Independent windows use the same synchronous popup API as Android;
browser popup blocking leaves the live session in its tab and displays a notice.
Browser-provided title/address chrome remains controlled by the browser.

Floating windows fit the existing framebuffer, preserving aspect ratio. They do
not renegotiate the remote resolution as the window is resized. Returning restores
the tab's zoom and adaptive-resolution behavior. Input, focus, visibility and
fullscreen listeners follow the canvas's owner document. The worker renderer also
moves animation scheduling and visibility listeners to the destination window.

## Verification (2026-11-13)

Production frontend build succeeded; 50 floating-window, RDP geometry and renderer
unit tests passed. Repository typecheck reports 570 existing errors; no errors in
the changed production modules in that check.

Real GUI Chromium with Linux xrdp/XFCE, 1280x720 legacy graphics:

- Open independent window and native Document PiP with the same canvas and socket.
- No uniTerm toolbar in either child; correct RDP window title.
- Type distinct text in each child and verify receipt in the remote Linux terminal.
- Mouse click, drag and release; keyboard focus in the child.
- Popup close, PiP close and Restore return the existing session to the main tab.
- Blocked popup leaves the session usable and shows an error.
- Missing PiP API falls back to the in-page window and restores successfully.
- Desktop frames continue across window changes; no browser page errors.

Evidence and repeatable browser script: ../artifacts/rdp-windows-20261113 in the
parent workspace. Windows servers, other browsers and the main-thread WASM fallback
were not part of this live acceptance run.

## Local sound switch

The inline status bar and main-page fullscreen toolbar have an accessible sound
switch, enabled by default. Turning it off stops queued playback and drops new
PCM packets before decoding or scheduling. Turning it back on unlocks Web Audio
from the click gesture and plays only newly arriving audio. Remote volume changes
remain independent. The choice survives reconnects within the same tab. This is
local playback control, not RDPSND channel renegotiation; it does not eliminate
server-to-client audio traffic. The floating windows still have no toolbar.

Build passed and 39 audio/floating-window/renderer unit tests passed, including
stopping queued sound, disabled packet dropping, fresh resume, remote volume
preservation and autoplay-notice races. This sound-switch change was not tested
against a live Windows audio source.
