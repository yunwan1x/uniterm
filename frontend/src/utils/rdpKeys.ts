import { REMOTE_KEY_SCANCODES } from './remoteKeyboard'
export const RDP_QUICK_KEYS = [
  { label: 'Ctrl+Alt+Del', codes: ['ControlLeft', 'AltLeft', 'Delete'] },
  { label: 'Ctrl+Shift+Esc', codes: ['ControlLeft', 'ShiftLeft', 'Escape'] },
  { label: 'Alt+Tab', codes: ['AltLeft', 'Tab'] },
  { label: 'Win', codes: ['MetaLeft'] },
  { label: 'Win+R', codes: ['MetaLeft', 'KeyR'] },
  ...['Escape', 'Tab', 'Enter', 'Backspace', 'Delete', 'Home', 'End', 'PageUp', 'PageDown', 'ArrowLeft', 'ArrowUp', 'ArrowDown', 'ArrowRight'].map((code, i) => ({ label: ['Esc','Tab','Enter','⌫','Del','Home','End','PgUp','PgDn','←','↑','↓','→'][i], codes: [code] })),
  ...Array.from({ length: 12 }, (_, i) => ({ label: `F${i + 1}`, codes: [`F${i + 1}`] })),
]
/** Balanced transaction: release in reverse order, never leave modifiers held. */
export function rdpKeyChord(codes: string[]): { code: number; down: boolean }[] {
  const keys = codes.map(code => REMOTE_KEY_SCANCODES[code])
  if (!keys.length || keys.some(code => code === undefined)) return []
  return [...keys.map(code => ({ code, down: true })), ...keys.reverse().map(code => ({ code, down: false }))]
}
