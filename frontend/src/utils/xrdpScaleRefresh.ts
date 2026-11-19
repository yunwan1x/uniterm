import type { RdpResizeArguments } from './rdpGeometry'

// xrdp ignores a scale-only layout at the current resolution. Wait for the
// temporary framebuffer before restoring the target so the two are observable
// even when rendering takes longer than a fixed delay.
export class XrdpScaleRefresh {
  private layout?: RdpResizeArguments
  private restore?: RdpResizeArguments
  private timer?: ReturnType<typeof setTimeout>
  private retriesLeft = 0

  constructor(private readonly send: (layout: RdpResizeArguments) => void) {}

  get pending() {
    return this.layout !== undefined
  }

  start(temporary: RdpResizeArguments, target: RdpResizeArguments) {
    this.cancel()
    this.restore = target
    this.request(temporary)
  }

  observe(width: number, height: number) {
    if (this.layout && this.layout[0] === width && this.layout[1] === height) this.advance()
  }

  cancel() {
    clearTimeout(this.timer)
    this.timer = undefined
    this.layout = undefined
    this.restore = undefined
  }

  private advance() {
    const next = this.restore
    this.cancel()
    if (next) this.request(next)
  }

  private request(layout: RdpResizeArguments) {
    this.layout = layout
    this.retriesLeft = 2
    this.sendLayout(layout)
  }

  private sendLayout(layout: RdpResizeArguments) {
    this.timer = setTimeout(() => {
      if (this.retriesLeft > 0) {
        this.retriesLeft--
        this.sendLayout(layout)
      } else {
        // A hidden or slow renderer can miss the temporary framebuffer.
        // Always finish by requesting the intended desktop size.
        this.advance()
      }
    }, 2000)
    this.send(layout)
  }
}
