import { describe, it, expect } from 'vitest'
import { toggleModifier, consumeKey, clampKeyboard, KEYBOARD_ROWS, FLOATING_SHORTCUTS, type ModifierState } from './floatingKeyboard'
import { rdpKeyChord } from './rdpKeys'
describe('floating keyboard input', () => {
  it('consumes one-shot modifiers once and balances wire key events', () => {
    const state = toggleModifier(toggleModifier({}, 'ControlLeft'), 'ShiftLeft')
    const result = consumeKey(state, 'KeyC')
    expect(result.codes).toEqual(['ControlLeft','ShiftLeft','KeyC'])
    expect(result.state).toEqual({})
    const events = rdpKeyChord(result.codes)
    expect(events.slice(0, 3).map(e=>e.code)).toEqual(events.slice(3).map(e=>e.code).reverse())
  })
  it('locks modifiers locally for repeated chords then explicitly unlocks', () => {
    let state: ModifierState = toggleModifier({}, 'ControlLeft', true)
    for (const key of ['KeyC','KeyV']) { const result = consumeKey(state,key); expect(result.codes).toEqual(['ControlLeft',key]); state=result.state }
    expect(toggleModifier(state,'ControlLeft')).toEqual({})
  })
  it('maps every visible key and shortcut to valid balanced scancodes', () => {
    for (const key of KEYBOARD_ROWS.flat()) expect(rdpKeyChord([key.code])).toHaveLength(2)
    for (const shortcut of FLOATING_SHORTCUTS) expect(rdpKeyChord(shortcut.codes)).toHaveLength(shortcut.codes.length*2)
    for (const letter of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') expect(KEYBOARD_ROWS.flat().some(k=>k.code===`Key${letter}`)).toBe(true)
  })
  it('clamps drag positions on all edges and when viewport shrinks below panel size', () => {
    expect(clampKeyboard(-50,900,800,600,700,250)).toEqual({x:0,y:350})
    expect(clampKeyboard(900,-5,800,600,700,250)).toEqual({x:100,y:0})
    expect(clampKeyboard(100,100,300,200,650,350)).toEqual({x:0,y:0})
  })
})
