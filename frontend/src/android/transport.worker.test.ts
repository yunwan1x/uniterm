import { afterEach, expect, it, vi } from 'vitest'

afterEach(() => vi.unstubAllGlobals())

it('sends Android PCM to the attached playback port, including after a processor replacement', async () => {
  const scope = { onmessage: null as any, postMessage: vi.fn(), close: vi.fn() }
  let receive: (event: { data: ArrayBuffer }) => void
  vi.stubGlobal('self', scope)
  vi.stubGlobal('WebSocket', class {
    set onmessage(callback: typeof receive) { receive = callback }
    close() {}
  })
  await import('./transport.worker')
  const control = new MessageChannel()
  const players = [new MessageChannel(), new MessageChannel()]
  try {
    scope.onmessage({ data: { type: 'connect', url: 'ws://localhost/test' } })
    scope.onmessage({ data: { type: 'audio', port: control.port1 } })
    for (const channel of players) {
      control.port2.postMessage({ type: 'attach', port: channel.port1 }, [channel.port1])
      const received = vi.fn()
      channel.port2.onmessage = ({ data }) => received(data)
      await vi.waitFor(() => {
        const packet = new Uint8Array(17)
        packet[0] = 2
        packet.set([0, 32, 0, 32], 13)
        receive({ data: packet.buffer })
        expect(received).toHaveBeenCalled()
      })
      const pcm = received.mock.calls[0][0]
      expect([pcm.type, pcm.rate, pcm.channels, pcm.bits]).toEqual(['pcm', 48000, 2, 16])
      expect(Array.from(pcm.data)).toEqual([0, 32, 0, 32])
      control.port2.postMessage({ type: 'detach' })
    }
  } finally {
    scope.onmessage({ data: { type: 'close' } })
    control.port2.close()
    players.forEach(channel => channel.port2.close())
  }
})
