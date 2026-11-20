import type { DisplayCounters } from '../utils/displayPerformance'

// Multiple dirty rectangles written before the next paint are one visible update.
export function observeMainThreadPerformance(canvas: HTMLCanvasElement, url: string,
  observeSocket: (url: string, callback: (socket: WebSocket) => void) => () => void) {
  const win = canvas.ownerDocument.defaultView!
  const context = canvas.getContext('2d', { alpha: false })
  const write = context?.putImageData
  let frames = 0
  let bytes: number | null = null
  let paint: number | undefined
  let socket: WebSocket | undefined
  const receive = (event: MessageEvent) => { bytes = (bytes ?? 0) + (event.data.byteLength ?? event.data.size ?? 0) }
  const unregister = observeSocket(url, next => {
    socket?.removeEventListener('message', receive)
    socket = next
    bytes = 0
    socket.addEventListener('message', receive)
  })
  if (context && write) {
    context.putImageData = function (this: CanvasRenderingContext2D, ...args: Parameters<typeof write>) {
      Reflect.apply(write, this, args)
      if (paint === undefined) paint = win.requestAnimationFrame(() => { frames++; paint = undefined })
    } as typeof write
  }
  return {
    read: (): DisplayCounters => ({ at: performance.now(), frames: context ? frames : null, bytes }),
    dispose() {
      unregister()
      socket?.removeEventListener('message', receive)
      if (paint !== undefined) win.cancelAnimationFrame(paint)
      if (context && write) context.putImageData = write
    },
  }
}
