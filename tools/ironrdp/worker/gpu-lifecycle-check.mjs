// Run against the Vite development server. Set REMOTE_BROWSER_CDP to test a
// hardware browser; otherwise launch a local Chromium that may use SwiftShader.
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
const cdp = process.env.REMOTE_BROWSER_CDP
const browser = cdp ? await chromium.connectOverCDP(cdp) : await chromium.launch({
  executablePath: process.env.CHROMIUM_EXECUTABLE,
  headless: true,
  args: ['--no-sandbox', '--enable-unsafe-swiftshader'],
})
const origin = (process.env.UNITERM_RENDER_TEST_ORIGIN || 'http://127.0.0.1:34116').replace(/\/$/, '')
let context
try {
  context = await browser.newContext()
  const page = await context.newPage()
  await page.goto(origin + '/src/rdp/gpu-compositor.ts')
  const result = await page.evaluate(async requireHardware => {
    const { GpuCompositor } = await import('/src/rdp/gpu-compositor.ts')
    const events = []
    const gpu = new GpuCompositor(rect => events.push(rect), requireHardware)
    const gl = gpu.yuv.gl
    let renderer = 'unavailable'
    try {
      const info = gl.getExtension('WEBGL_debug_renderer_info')
      if (info) renderer = gl.getParameter(info.UNMASKED_RENDERER_WEBGL)
    } catch { /* Renderer metadata is diagnostic only. */ }
    const assert = (condition, message) => { if (!condition) throw new Error(message) }
    const equal = (actual, expected, label) => {
      assert(actual && actual.length === expected.length, label + ': size differs')
      const index = actual.findIndex((value, i) => value !== expected[i])
      assert(index < 0, label + ': pixels differ at byte ' + index)
    }
    const blank = (width, height) => {
      const pixels = new Uint8Array(width * height * 4)
      for (let i = 3; i < pixels.length; i += 4) pixels[i] = 255
      return pixels
    }
    const patch = (destination, destinationWidth, source, sourceWidth, sourceRect, points) => {
      const [left, top, right, bottom] = sourceRect
      // Snapshot so all destinations use the same source, including overlaps.
      const snapshot = source.slice()
      for (const [dx, dy] of points) for (let y = top; y < bottom; y++) {
        const start = (y * sourceWidth + left) * 4
        destination.set(snapshot.subarray(start, start + (right - left) * 4), ((dy + y - top) * destinationWidth + dx) * 4)
      }
    }
    const gray = (width, height, level) => {
      const pixels = blank(width, height)
      for (let i = 0; i < pixels.length; i += 4) pixels.fill(level, i, i + 3)
      return pixels
    }
    const yuv = (width, height, level) => [
      new Uint8Array(width * height).fill(level),
      new Uint8Array(Math.ceil(width / 2) * Math.ceil(height / 2)).fill(128),
      new Uint8Array(Math.ceil(width / 2) * Math.ceil(height / 2)).fill(128),
    ]

    // Track compositor-owned FBOs only. YuvGpu owns its own standalone FBO.
    const liveFramebuffers = new Set()
    let createdFramebuffers = 0, deletedFramebuffers = 0, readbacks = 0
    const createFramebuffer = gl.createFramebuffer.bind(gl)
    const deleteFramebuffer = gl.deleteFramebuffer.bind(gl)
    const readPixels = gl.readPixels.bind(gl)
    gl.createFramebuffer = () => {
      const framebuffer = createFramebuffer()
      if (framebuffer) { liveFramebuffers.add(framebuffer); createdFramebuffers++ }
      return framebuffer
    }
    gl.deleteFramebuffer = framebuffer => {
      if (liveFramebuffers.delete(framebuffer)) deletedFramebuffers++
      return deleteFramebuffer(framebuffer)
    }
    gl.readPixels = (...args) => { readbacks++; return readPixels(...args) }

    const sourceWidth = 16, sourceHeight = 12, targetWidth = 20, targetHeight = 16
    const source = blank(sourceWidth, sourceHeight), target = blank(targetWidth, targetHeight)
    for (let y = 0; y < sourceHeight; y++) for (let x = 0; x < sourceWidth; x++) {
      source.set([x * 13, y * 17, (x + y) * 7, 255], (y * sourceWidth + x) * 4)
    }
    gpu.reset(24, 20)
    gpu.create(1, sourceWidth, sourceHeight)
    gpu.create(2, targetWidth, targetHeight)
    gpu.map(2, 0, 0)
    gpu.bitmap(1, [0, 0, sourceWidth, sourceHeight], source)
    gpu.copy(1, 2, [2, 1, 9, 6], [[0, 0], [10, 8]])
    patch(target, targetWidth, source, sourceWidth, [2, 1, 9, 6], [[0, 0], [10, 8]])
    assert(events.length === 0, 'partial cross-surface update was presented')
    gpu.frame()
    assert(readbacks === 0, 'cross-surface copy performed CPU readback')
    equal(gpu.readSurface(2), target, 'cross-surface copy')

    // Self-copy uses a scratch FBO and releases it after all destinations.
    const beforeScratch = liveFramebuffers.size
    gpu.copy(2, 2, [0, 0, 7, 5], [[2, 2], [4, 4]])
    patch(target, targetWidth, target, targetWidth, [0, 0, 7, 5], [[2, 2], [4, 4]])
    assert(liveFramebuffers.size === beforeScratch, 'self-copy leaked its scratch FBO')
    gpu.frame()
    equal(gpu.readSurface(2), target, 'overlapping self-copy')

    const cached = blank(4, 3)
    patch(cached, 4, source, sourceWidth, [3, 2, 7, 5], [[0, 0]])
    gpu.store(1, 7, [3, 2, 7, 5])
    gpu.restore(7, 2, [[8, 1], [1, 10]])
    patch(target, targetWidth, cached, 4, [0, 0, 4, 3], [[8, 1], [1, 10]])
    gpu.frame()
    equal(gpu.readSurface(2), target, 'cache restore')
    const beforeEviction = liveFramebuffers.size
    gpu.evict(7)
    assert(liveFramebuffers.size === beforeEviction - 1, 'cache eviction retained its FBO')
    gpu.restore(7, 2, [[0, 0]])
    gpu.frame()
    equal(gpu.readSurface(2), target, 'restore from evicted slot changed pixels')

    gpu.store(1, 7, [3, 2, 7, 5])
    gpu.reset(28, 22)
    assert(liveFramebuffers.size === 1, 'reset did not retain only the cached FBO')
    gpu.create(3, 28, 22)
    gpu.map(3, 0, 0)
    gpu.restore(7, 3, [[5, 6]])
    const resetExpected = blank(28, 22)
    patch(resetExpected, 28, cached, 4, [0, 0, 4, 3], [[5, 6]])
    gpu.frame()
    equal(gpu.readSurface(3), resetExpected, 'cache survives reset and enlargement')

    // Switching to the helper's standalone FBO must not replace a surface FBO.
    const beforeTargetYuv = readbacks
    gpu.yuvBitmap(3, 0, 28, 22, ...yuv(28, 22, 110), [[0, 0, 28, 22]])
    gpu.frame()
    assert(readbacks === beforeTargetYuv, 'target YUV performed CPU readback')
    equal(gpu.readSurface(3), gray(28, 22, 110), 'first target YUV')
    equal(gpu.yuv.convert(0, 8, 6, ...yuv(8, 6, 50), 0, 0, 8, 6), gray(8, 6, 50), 'standalone YUV')
    equal(gpu.readSurface(3), gray(28, 22, 110), 'standalone damaged target')
    gpu.yuvBitmap(3, 0, 28, 22, ...yuv(28, 22, 170), [[0, 0, 28, 22]])
    gpu.frame()
    equal(gpu.readSurface(3), gray(28, 22, 170), 'target after standalone YUV')

    gpu.reset(14, 10)
    assert(liveFramebuffers.size === 1, 'shrinking reset leaked a surface FBO')
    gpu.create(4, 14, 10)
    gpu.map(4, 0, 0)
    gpu.restore(7, 4, [[2, 2]])
    const resized = blank(14, 10)
    patch(resized, 14, cached, 4, [0, 0, 4, 3], [[2, 2]])
    gpu.frame()
    const bitmap = gpu.canvas.transferToImageBitmap()
    assert(bitmap.width === 14 && bitmap.height === 10, 'output did not shrink')
    const output = new OffscreenCanvas(14, 10), context = output.getContext('2d')
    context.drawImage(bitmap, 0, 0)
    bitmap.close()
    equal(new Uint8Array(context.getImageData(0, 0, 14, 10).data.buffer), resized, 'resized presentation')

    gpu.close()
    assert(!gpu.active && liveFramebuffers.size === 0, 'close retained active surfaces or FBOs')
    assert(createdFramebuffers === deletedFramebuffers, 'compositor FBO counts do not balance')
    // Test context loss last, after testing normal resource cleanup.
    const lose = gl.getExtension('WEBGL_lose_context')
    assert(lose, 'context-loss extension is unavailable')
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('context-loss event timeout')), 2000)
      gpu.canvas.addEventListener('webglcontextlost', event => {
        event.preventDefault(); clearTimeout(timer); resolve()
      }, { once: true })
      lose.loseContext()
    })
    let frameRejected = false, yuvRejected = false
    try { gpu.frame() } catch { frameRejected = true }
    try { gpu.yuv.convert(0, 8, 6, ...yuv(8, 6, 50), 0, 0, 8, 6) } catch { yuvRejected = true }
    assert(frameRejected && yuvRejected, 'context loss was not rejected')
    return {
      renderer, requireHardware, frames: events.length, crossSurfaceCopy: true, overlappingSelfCopy: true,
      cacheRestore: true, cacheEviction: true, cacheAfterReset: true,
      targetStandaloneTarget: true, resizePresentation: true, contextLoss: true,
      createdFramebuffers, deletedFramebuffers, remainingFramebuffers: liveFramebuffers.size,
    }
  }, Boolean(cdp))
  console.log(JSON.stringify(result))
} finally {
  await context?.close()
  await browser.close()
}
