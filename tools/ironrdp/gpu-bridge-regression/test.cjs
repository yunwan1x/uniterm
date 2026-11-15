'use strict'
const assert = require('node:assert/strict')
const path = require('node:path')
const binding = require(path.resolve(process.argv[2] || './pkg/uniterm_gpu_copy_test.js'))
const OriginalUint8Array = globalThis.Uint8Array
let copies = 0
globalThis.Uint8Array = new Proxy(OriginalUint8Array, {
  construct(target, args, newTarget) {
    if (args[0] instanceof OriginalUint8Array) copies++
    return Reflect.construct(target, args, newTarget)
  },
})

const results = []
function test(name, body) {
  delete globalThis.unitermGpuCommand
  copies = 0
  try { body(); results.push({ name, passed: true }) }
  catch (error) { results.push({ name, passed: false, error: error.message }) }
  finally { delete globalThis.unitermGpuCommand }
}
const expectedBitmap = ['bitmap', 9, [2, 3, 4, 4], [17, 34, 51, 255, 68, 85, 102, 255]]
const snapshot = (name, ...args) => [name, ...args.map(arg => ArrayBuffer.isView(arg) ? [...arg] : arg)]

// oracle: With no renderer, forwarding a bitmap must not clone its RGBA buffer.
// This is the regression from the measured Canvas2D fallback, not a timing test.
test('missing_bridge_does_not_copy_rgba', () => {
  assert.equal(binding.externally_composited(), false)
  binding.emit_bitmap()
  assert.equal(copies, 0, 'unavailable GPU bridge must not clone RGBA')
})

// oracle: Existing bridge lookup treats a non-function as unavailable.
test('non_callable_bridge_does_not_copy_rgba', () => {
  globalThis.unitermGpuCommand = { active: false }
  binding.emit_bitmap()
  assert.equal(copies, 0, 'non-callable GPU bridge must not clone RGBA')
})

// oracle: A failed property lookup is unavailable, and existing code resolves
// the callable exactly once for each command.
test('throwing_bridge_lookup_does_not_copy_rgba', () => {
  Object.defineProperty(globalThis, 'unitermGpuCommand', {
    configurable: true,
    get() { throw new Error('fixture lookup failure') },
  })
  assert.doesNotThrow(() => binding.emit_bitmap())
  assert.equal(copies, 0)
})

test('callable_bridge_is_resolved_once_per_command', () => {
  let lookups = 0
  const calls = []
  Object.defineProperty(globalThis, 'unitermGpuCommand', {
    configurable: true,
    get() {
      lookups++
      return (...args) => calls.push(snapshot(...args))
    },
  })
  binding.emit_bitmap()
  assert.equal(lookups, 1)
  assert.deepEqual(calls, [expectedBitmap])
  assert.equal(copies, 1)
})

// oracle: The existing renderer is initially inactive and becomes active only
// after reset. Callable presence must preserve pre-reset command delivery.
test('callable_inactive_bridge_still_receives_bitmap', () => {
  const calls = []
  globalThis.unitermGpuCommand = (name, ...args) => {
    if (name === 'active') return false
    calls.push(snapshot(name, ...args))
  }
  assert.equal(binding.externally_composited(), false)
  binding.emit_bitmap()
  assert.deepEqual(calls, [expectedBitmap])
  assert.equal(copies, 1)
})

// oracle: Explicit fixture pixels/rectangle and handler invocation order, with
// reset enabling the GPU and close disabling it. No production-generated oracle.
test('bootstrap_and_bitmap_arguments_preserve_order_and_bytes', () => {
  const calls = []
  let active = false
  globalThis.unitermGpuCommand = (name, ...args) => {
    if (name === 'active') return active
    calls.push(snapshot(name, ...args))
    if (name === 'reset') active = true
    if (name === 'close') active = false
  }
  assert.equal(binding.externally_composited(), false)
  binding.emit_bootstrap()
  assert.deepEqual(calls, [
    ['reset', 8, 6], ['create', 9, 8, 6], ['map', 9, 1, 2],
    expectedBitmap, ['frame'], ['close'],
  ])
  assert.equal(binding.externally_composited(), false)
  assert.equal(copies, 1)
})

// oracle: The bridge is looked up per call; removing it must take effect on the
// next bitmap, while a later registered function must work without a reconnect.
test('bridge_removal_and_replacement_are_observed', () => {
  let calls = 0
  globalThis.unitermGpuCommand = () => { calls++ }
  binding.emit_bitmap()
  assert.equal(copies, 1)
  assert.equal(calls, 1)
  delete globalThis.unitermGpuCommand
  binding.emit_bitmap()
  assert.equal(copies, 1, 'removed GPU bridge must not clone another RGBA buffer')
  globalThis.unitermGpuCommand = () => { calls++ }
  binding.emit_bitmap()
  assert.equal(copies, 2)
  assert.equal(calls, 2)
})

// oracle: The existing bridge treats JS callback exceptions as failed delivery,
// without propagating a new Rust/JS error or retaining the failed callback.
test('throwing_bridge_keeps_failure_semantics', () => {
  globalThis.unitermGpuCommand = () => { throw new Error('fixture callback failure') }
  assert.doesNotThrow(() => binding.emit_bitmap())
  assert.equal(binding.externally_composited(), false)
  assert.equal(copies, 1)
  const calls = []
  globalThis.unitermGpuCommand = (...args) => calls.push(snapshot(...args))
  binding.emit_bitmap()
  assert.deepEqual(calls, [expectedBitmap])
})

globalThis.Uint8Array = OriginalUint8Array
console.log(JSON.stringify({ passed: results.every(result => result.passed), results }, null, 2))
if (results.some(result => !result.passed)) process.exitCode = 1
