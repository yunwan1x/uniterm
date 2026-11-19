# RDP resize reactivation channel routing

## Reproduction

With xrdp 0.10.6.1, xorgxrdp 0.10.4 and the bundled uniterm.21 engine,
connect using TLS and GFX, play continuous PCM audio in the remote desktop,
and repeatedly change the actual zoom dropdown between 75%, 100%, 150%, 100%.
At 2026-11-19 11:49:16 CST the old client failed with:

```
kind=0 [decode error] decode error:
ShareControlHeader ... invalid pdu_type at offset 6: invalid pdu type
```

This reproduces the user's reported error independently of the optional xrdp
physical-DPI bridge (compatibility disabled). The XFCE session remains alive.
A separate earlier attempt encountered the existing clipboard reconnect error;
it was excluded and the desktop session was reset before the controlled run.

## Cause and fix

The browser's Deactivation-Reactivation loop previously passed every matching
X.224 frame to ConnectionActivationSequence. MCS virtual-channel payloads can
arrive during activation; their headers are not ShareControlHeader, so decoding
one as a Share PDU fails. read_by_hint also discarded unmatched fast-path frames.

uniterm.22 classifies by transport action and MCS channel before decoding Share
PDUs. Global I/O-channel traffic advances activation. Interleaved static-channel
and fast-path traffic goes through ActiveStage; responses are sent immediately,
other outputs are retained in order, and termination is handled immediately.
Standard RDP Security input/output envelopes are handled once per frame.
Malformed transport data is not ignored. This changes only reactivation handling;
the Windows/default frontend resize policy remains the original three arguments.

## Validation

- Deterministic channel-routing regression tests: 3 passed, including old-decoder
  rejection of a valid non-Share channel payload, fast-path routing and malformed
  transport rejection.
- Entire ironrdp-session unit suite: 50 passed.
- Frontend geometry, zoom and Windows-isolation tests: 53 passed.
- WASM, Vite production frontend and Go server builds passed.
- uniterm.22, compatibility disabled: 24 real zoom-dropdown changes with ongoing
  remote audio completed without decode error; audio packet counts kept increasing.
- Compatibility enabled: another 12 dropdown changes passed with audio; final
  XFCE settings remained 192 DPI / GTK scale 2. The private DPI atom was absent.
- Combined patch applies cleanly to pinned IronRDP base 905c28b3.

The tarball frontend/vendor/ys-ll-ironrdp-wasm-0.5.2-uniterm.22.tgz is pinned in
package.json/package-lock.json. Source is retained in tools/ironrdp/patches/uniterm.patch.
No xrdp server code was modified. No external client deployment or release was
performed. Real Windows-server interoperability has not been exercised here.
