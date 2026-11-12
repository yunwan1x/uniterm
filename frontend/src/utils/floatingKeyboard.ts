export const MODIFIERS = ['ControlLeft', 'AltLeft', 'ShiftLeft', 'MetaLeft'] as const
export type Modifier = typeof MODIFIERS[number]
export type ModifierState = Partial<Record<Modifier, 'once' | 'locked'>>
export function toggleModifier(state: ModifierState, key: Modifier, lock = false): ModifierState {
  const next = { ...state }
  if (lock) next[key] = 'locked'
  else if (next[key]) delete next[key]
  else next[key] = 'once'
  return next
}
export function consumeKey(state: ModifierState, code: string) {
  return {
    codes: [...MODIFIERS.filter(key => state[key]), code],
    state: Object.fromEntries(Object.entries(state).filter(([, mode]) => mode === 'locked')) as ModifierState,
  }
}
export function clampKeyboard(x: number, y: number, width: number, height: number, panelWidth: number, panelHeight: number) {
  return { x: Math.max(0, Math.min(x, Math.max(0, width - panelWidth))), y: Math.max(0, Math.min(y, Math.max(0, height - panelHeight))) }
}
export type KeyboardKey = { label: string; code: string; grow?: number }
const keys = (labels: string[], codes: string[]) => labels.map((label, i) => ({ label, code: codes[i] }))
const letters = (value: string) => [...value].map(label => ({ label, code: `Key${label}` }))
export const KEYBOARD_ROWS: KeyboardKey[][] = [
  [{ label: 'Esc', code: 'Escape' }, ...Array.from({ length: 12 }, (_, i) => ({ label: `F${i + 1}`, code: `F${i + 1}` })), { label: 'Del', code: 'Delete' }],
  [...keys(['`', '1','2','3','4','5','6','7','8','9','0','−','='], ['Backquote', ...[1,2,3,4,5,6,7,8,9,0].map(i => `Digit${i}`), 'Minus', 'Equal']), { label: '⌫', code: 'Backspace', grow: 1.6 }],
  [{ label: 'Tab', code: 'Tab', grow: 1.5 }, ...letters('QWERTYUIOP'), ...keys(['[',']','\\'], ['BracketLeft','BracketRight','Backslash'])],
  [{ label: 'Caps', code: 'CapsLock', grow: 1.7 }, ...letters('ASDFGHJKL'), ...keys([';',"'"], ['Semicolon','Quote']), { label: 'Enter', code: 'Enter', grow: 2 }],
  [{ label: 'Shift', code: 'ShiftLeft', grow: 2 }, ...letters('ZXCVBNM'), ...keys([',','.','/'], ['Comma','Period','Slash']), { label: 'Shift', code: 'ShiftLeft', grow: 2 }],
  [{ label: 'Ctrl', code: 'ControlLeft' }, { label: 'Win', code: 'MetaLeft' }, { label: 'Alt', code: 'AltLeft' }, { label: 'Space', code: 'Space', grow: 5 }, ...keys(['Home','End','PgUp','PgDn'], ['Home','End','PageUp','PageDown']), ...keys(['←','↓','↑','→'], ['ArrowLeft','ArrowDown','ArrowUp','ArrowRight'])],
]
export const FLOATING_SHORTCUTS = [
  { label: 'Ctrl+C', codes: ['ControlLeft', 'KeyC'] },
  { label: 'Ctrl+V', codes: ['ControlLeft', 'KeyV'] },
  { label: 'Alt+Tab', codes: ['AltLeft', 'Tab'] },
  { label: 'Win+D', codes: ['MetaLeft', 'KeyD'] },
  { label: 'Ctrl+Alt+Del', codes: ['ControlLeft', 'AltLeft', 'Delete'] },
  { label: 'Ctrl+Shift+Esc', codes: ['ControlLeft', 'ShiftLeft', 'Escape'] },
  { label: 'Win+R', codes: ['MetaLeft', 'KeyR'] },
]
