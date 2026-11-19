export type RdpDesktopSize = { width: number; height: number }
export type RdpDisplayRect = RdpDesktopSize & { left: number; top: number }

/** Use the same aligned size for initial negotiation and subsequent resizes. */
export function adaptiveRdpSize(width: number, height: number, pixelRatio = 1): RdpDesktopSize {
  const ratio = Number.isFinite(pixelRatio) && pixelRatio > 0 ? pixelRatio : 1
  return {
    width: Math.max(640, Math.min(0xfffe, Math.floor(width * ratio / 2) * 2)),
    height: Math.max(480, Math.min(0xfffe, Math.floor(height * ratio / 2) * 2)),
  }
}

/** The visible bitmap inside a centered object-fit canvas. */
export function rdpContentRect(
  bounds: RdpDisplayRect,
  desktop: RdpDesktopSize,
  adaptive: boolean,
): RdpDisplayRect | null {
  if (bounds.width <= 0 || bounds.height <= 0 || desktop.width <= 0 || desktop.height <= 0) return null
  // DOMRect coordinates are prototype accessors, so object spread loses them.
  if (adaptive) return { left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height }
  const scale = Math.min(bounds.width / desktop.width, bounds.height / desktop.height)
  const width = desktop.width * scale
  const height = desktop.height * scale
  return {
    left: bounds.left + (bounds.width - width) / 2,
    top: bounds.top + (bounds.height - height) / 2,
    width,
    height,
  }
}

export function rdpPointerPosition(
  clientX: number,
  clientY: number,
  bounds: RdpDisplayRect,
  desktop: RdpDesktopSize,
  adaptive: boolean,
  clampOutside = false,
): { x: number; y: number } | null {
  const content = rdpContentRect(bounds, desktop, adaptive)
  if (!content) return null
  if (!clampOutside && (clientX < content.left || clientY < content.top ||
    clientX >= content.left + content.width || clientY >= content.top + content.height)) return null
  return {
    x: Math.max(0, Math.min(desktop.width - 1, Math.floor((clientX - content.left) / content.width * desktop.width))),
    y: Math.max(0, Math.min(desktop.height - 1, Math.floor((clientY - content.top) / content.height * desktop.height))),
  }
}

/** Virtual RDP monitor millimetres encode the requested UI scale for RandR.
 * The protocol accepts 10..10000 mm. These are not real monitor measurements.
 */
export function rdpScaledResize(width: number, height: number, percent: number): [number, number, number, number, number] {
  const scale = Number.isFinite(percent) ? Math.min(500, Math.max(100, Math.round(percent))) : 100
  const dpi = 96 * scale / 100
  const millimetres = (pixels: number) => Math.max(10, Math.min(10000, Math.round(pixels * 25.4 / dpi)))
  return [width, height, scale, millimetres(width), millimetres(height)]
}

/** Upstream xrdp ignores layout updates with unchanged framebuffer dimensions. */
export function rdpScaleRefreshSize(width: number, height: number): RdpDesktopSize {
  return { width: width > 640 ? width - 2 : width + 2, height }
}

export type RdpResizeArguments = [number, number, number] | [number, number, number, number, number]

/** Preserve the original Windows RDP messages unless xrdp compatibility is explicit. */
export function rdpResizeRequests(width: number, height: number, scale: number,
  current: RdpDesktopSize | null, xrdpCompatibility = false): [RdpResizeArguments, RdpResizeArguments?] {
  if (!xrdpCompatibility) return [[width, height, scale]]
  const target = rdpScaledResize(width, height, scale)
  if (current?.width !== width || current.height !== height) return [target]
  const refresh = rdpScaleRefreshSize(width, height)
  return [rdpScaledResize(refresh.width, refresh.height, scale), target]
}
