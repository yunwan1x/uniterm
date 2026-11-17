# Audio processor recovery (2026-11-17)

An AudioWorklet processor error previously only set the blocked indicator. Sound toggles reused the failed processor. The network worker could also retain unacknowledged PCM bytes until its 256 KiB cap, dropping subsequent audio indefinitely.

The player now replaces the failed processor and its direct PCM MessageChannel, preserving volume and enabled state. A stable control channel delivers replacement endpoints and remote volume changes. PCM continues directly from the network worker to the audio worklet. Detach/attach resets pending-byte accounting; acknowledgements from obsolete ports are ignored.

Automatic recovery is bounded to three attempts per player, delayed 250/500/750 ms. An explicit sound off/on permits another recovery cycle. Disabling sound cancels pending recovery; disposal prevents late asynchronous setup. Diagnostics expose processor failures and recovery attempts.

Validation:
- 25 passing Vitest tests across audioRecovery, rdpAudio and session.worker.
- Production Vite build passes (existing large-chunk warning).
- Real Chromium AudioWorklet fault injection: nonzero PCM output before and after a processor crash, fresh-port packet delivery, muted output, no rebuild while disabled, manual retry, and no rebuild after disposal all passed. A real producer Worker feeds PCM; output is measured with an AnalyserNode. The injected crash is confined to the external test fixture, not production source.

This repairs browser-side processor failure recovery. It does not establish the cause of the reported Windows RDP audio loss, reset Windows audio services, or repair a server-side RDPSND failure. No router deployment or Docker image publication is included.

Full vue-tsc remains blocked by pre-existing errors: baseline and fix have identical diagnostic locations and codes; no new diagnostic locations.
