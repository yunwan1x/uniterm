import { expect, it } from 'vitest'
import { PresentationTrace } from './presentation-trace'
it('bounds the enabled flow Worker buffer, counts overflow and resets on drain', () => {
  const trace = new PresentationTrace(true, 16384)
  for (let id = 0; id < 16387; id++) trace.record('probe', id)
  const full = trace.drain()
  expect(full.events).toHaveLength(16384)
  expect(full.dropped).toBe(3)
  trace.record('next', 16387)
  expect(trace.drain()).toMatchObject({ dropped: 0, events: [{ stage: 'next', id: 16387 }] })
  trace.dispose()
})
