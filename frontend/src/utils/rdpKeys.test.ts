import { expect, it } from 'vitest'
import { RDP_QUICK_KEYS, rdpKeyChord } from './rdpKeys'
it('sends extended Delete and balanced modifiers in reverse release order', () => {
 expect(rdpKeyChord(['ControlLeft','AltLeft','Delete'])).toEqual([
  {code:0x1d,down:true},{code:0x38,down:true},{code:0xe053,down:true},
  {code:0xe053,down:false},{code:0x38,down:false},{code:0x1d,down:false},
 ])
})
it('all shortcuts including F12 balance presses and releases; invalid chords send nothing', () => {
 for (const key of RDP_QUICK_KEYS) {
  const events=rdpKeyChord(key.codes);expect(events.length).toBe(key.codes.length*2)
  expect(events.filter(e=>e.down).map(e=>e.code)).toEqual(events.filter(e=>!e.down).map(e=>e.code).reverse())
 }
 expect(rdpKeyChord(['ControlLeft','Unknown'])).toEqual([])
 expect(rdpKeyChord(['F12'])).toEqual([{code:0x58,down:true},{code:0x58,down:false}])
})
