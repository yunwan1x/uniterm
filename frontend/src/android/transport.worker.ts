/// <reference lib="webworker" />
const scope = self as unknown as DedicatedWorkerGlobalScope
let socket: WebSocket | undefined, audio: MessagePort | undefined, pending = 0, audioPending = 0
scope.onmessage = ({ data: m }) => {
  if (m.type === 'connect') {
    socket = new WebSocket(m.url)
    socket.binaryType = 'arraybuffer'
    socket.onopen = () => scope.postMessage({ type: 'open' })
    socket.onerror = () => scope.postMessage({ type: 'error' })
    socket.onclose = e => { audio?.close(); scope.postMessage({ type: 'close', code: e.code, reason: e.reason }) }
    socket.onmessage = ({ data }) => {
      if (data instanceof ArrayBuffer) {
        const bytes = new Uint8Array(data)
        if (bytes.length >= 13 && bytes[0] === 2 && audio) {
          if (audioPending + bytes.length - 13 > 256 * 1024) return
          audioPending += bytes.length - 13
          audio.postMessage({ type: 'pcm', data: bytes.subarray(13), rate: 48000, channels: 2, bits: 16 }, [data])
          return
        }
        pending += data.byteLength
        if (pending > 16 * 1024 * 1024) { socket?.close(1000, 'Video consumer stalled; reconnect'); return }
        scope.postMessage({ type: 'message', data }, [data])
      } else scope.postMessage({ type: 'message', data })
    }
  } else if (m.type === 'send' && socket?.readyState === WebSocket.OPEN) socket.send(m.data)
  else if (m.type === 'ack') pending = Math.max(0, pending - m.bytes)
  else if (m.type === 'audio') {
    audio?.close(); audio = m.port; audioPending = 0
    audio!.onmessage = ({ data }: MessageEvent) => { if (data.type === 'consumed') audioPending = Math.max(0, audioPending - data.bytes) }
    audio!.start()
  }
  else if (m.type === 'close') { socket?.close(); audio?.close(); scope.close() }
}

export {}
