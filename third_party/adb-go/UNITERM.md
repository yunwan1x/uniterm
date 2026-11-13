Source: https://github.com/juanlianyangyang/adb-go
Pinned commit: 5acae68d6a534e44d5d0437397111bedbbc6077e
License: AGPL-3.0 (see LICENSE).

Local integration patches: pairing cancellation and packet bounds; close TCP on handshake cancellation; drain received data before EOF. Upstream discovery tests are not included; uniTerm regression tests cover the integration.

The unused key.go helper with a shared embedded private key is intentionally excluded. uniTerm generates and persists worker-local keys. Writes are serialized and bounded by a transport write deadline.
