# Native xrdp / XFCE scale synchronization

The per-connection "xrdp desktop scaling" option (rdpXrdpScaleCompatibility)
is OFF by default, including for existing connections. Windows RDP connections
keep the original three-argument resize call and never schedule the temporary
resize. Enable this option explicitly only for configured xrdp/XFCE servers.
The setting is saved with the connection and resets to false for new forms.

When enabled, UniTerm sends its existing local scale percent and corresponding virtual monitor
millimetres through the public IronRDP resize API. DPI = 96 * scale / 100;
mm = round(pixels * 25.4 / DPI), bounded to the protocol range 10..10000 mm.
This lets unmodified xrdp/xorgxrdp expose the requested scale as RandR physical DPI.
The server-side external XFCE helper translates RandR notifications to xfconf.
No xrdp source patch or private X11 property is required.

Upstream xrdp 0.10.6.1 ignores same-framebuffer layout updates. For these requests,
UniTerm sends a two-pixel width change followed 300 ms later by the intended size,
with matching virtual physical sizes on both messages. Post-connect retries are
bounded; restore/retry timers are cancelled during teardown. This compatibility
sequence can cause brief resizing. Fixed-resolution mode is unchanged.

Validation: 53 geometry/zoom/isolation unit tests pass; Vite production build and Go server
build pass. Whole-project typecheck has 178 distinct pre-existing diagnostic
messages, identical after normalizing source line numbers before/after this change.
Before adding the opt-in gate, live browser tests against unmodified xrdp 0.10.6.1 and xorgxrdp 0.10.4 passed:
100% => 96 DPI, 150% => 144 DPI, 200% => 192 DPI, both on connect and viewport resize.
The private _XRDP_DESKTOP_SCALE_FACTOR property was absent throughout.
GTK widget scaling remains integer-only, and physical millimetre rounding can
introduce small DPI errors at other dimensions/scales.

Deployment: source and built frontend are in this checkout; test server binary
is /tmp/uniterm-native-scale-worker. No user's external client deployment has
been updated. The user's UniTerm instance must be rebuilt/deployed from these
changes. Temporary loopback test services and the test account were cleaned up.

Origin synchronization: working branch investigate/xrdp-lag-20261118 was
fast-forwarded to origin/main 985cafb4 (two new commits) on 2026-11-19.
Local edits were stashed and restored without conflicts. No commit or push was
performed. Windows isolation is validated at the resize-message level, not with
a real Windows RDP server.
