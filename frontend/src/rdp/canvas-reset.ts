/** Observe backing-store replacement without changing any global canvas prototype. */
export function watchCanvasReset(canvas: OffscreenCanvas, onReset: () => void): () => void {
  const names = ['width', 'height'] as const
  const originals = new Map<string, PropertyDescriptor | undefined>()
  const wrappers = new Map<string, PropertyDescriptor>()
  for (const name of names) {
    let prototype = Object.getPrototypeOf(canvas), accessor: PropertyDescriptor | undefined
    while (prototype) {
      const descriptor = Object.getOwnPropertyDescriptor(prototype, name)
      if (descriptor?.get && descriptor.set) { accessor = descriptor; break }
      prototype = Object.getPrototypeOf(prototype)
    }
    if (!accessor) throw new Error(`RDP worker OffscreenCanvas ${name} accessor unavailable`)
    const original = Object.getOwnPropertyDescriptor(canvas, name)
    if (original && !original.configurable) throw new Error(`RDP worker OffscreenCanvas ${name} cannot be observed`)
    originals.set(name, original)
    const get = accessor.get!, set = accessor.set!
    wrappers.set(name, {
      configurable: true, enumerable: accessor.enumerable,
      get(this: OffscreenCanvas) { return get.call(this) },
      set(this: OffscreenCanvas, value: number) {
        set.call(this, value)
        if (this === canvas) onReset()
      },
    })
  }
  const restore = () => {
    for (const name of names) {
      const current = Object.getOwnPropertyDescriptor(canvas, name), wrapper = wrappers.get(name)!
      if (!current || current.get !== wrapper.get || current.set !== wrapper.set) continue
      const original = originals.get(name)
      if (original) Object.defineProperty(canvas, name, original)
      else Reflect.deleteProperty(canvas, name)
    }
  }
  try { for (const name of names) Object.defineProperty(canvas, name, wrappers.get(name)!) }
  catch (error) { restore(); throw new Error(`RDP worker OffscreenCanvas reset observer failed: ${error instanceof Error ? error.message : String(error)}`) }
  return restore
}
