# Mosh DNS connection fix — 2026-11-12

The connection form correctly sends the SSH hostname, custom port and password.
The Mosh dependency's `Dial` uses `net.ParseIP(host)` directly and does not resolve
DNS names. Passing a domain produces a nil IP, so the UDP socket connects to
loopback even after SSH successfully bootstraps the remote server. The deployed
v1.3 reproduction showed a UDP socket to 127.0.0.1 and a blank terminal.

The session now takes the address of the authenticated SSH peer and creates an
IPv4/IPv6 UDP connection to the negotiated Mosh port, passing it to `DialConn`.
It does not perform an independent DNS lookup that could select another server.
No credential handling or remote firewall settings were changed.

Creating a UDP socket is no longer treated as a completed connection: the
remote must acknowledge the encrypted initial resize state. A ten-second timeout
reports the UDP destination and advises checking the remote UDP port/firewall.
Cancellation and timeout close the newly created connections.

Validation:
- Unit tests: IPv4 and IPv6 loopback transport, authenticated acknowledgement,
  timeout/cancellation, invalid address/port/key and credential-safe errors.
- Existing SSH authentication and host-key regression tests pass.
- Production server build passes in the Alpine build environment.
- Real uniTerm browser test, using the connection form: Mosh, the user-provided
  domain, SSH port 28246, password authentication. Save & Connect succeeds.
- A harmless printf command returns `UNITERM_MOSH_OK` from the remote shell;
  terminal export confirms the output line. Browser reports no script errors.

Screenshots and test results are in artifacts/mosh-fix-20261112 (workspace root).
The published v1.3 image has not been replaced by this change.
