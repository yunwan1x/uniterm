import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'

beforeEach(() => {
  vi.resetModules()
  const data = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => data.set(k, v),
    removeItem: (k: string) => data.delete(k),
  })
})
afterEach(() => vi.unstubAllGlobals())
describe('browser-local table column preferences', () => {
  it('isolates resource kinds while sharing preferences between instances', async () => {
    const m = await import('./useTableColumns')
    const a = m.useTableColumns(), b = m.useTableColumns()
    m.setColumnVisible('pods', 'cpu', false)
    expect(a.columnIsVisible('pods', 'cpu')).toBe(false)
    expect(b.columnIsVisible('pods', 'cpu')).toBe(false)
    expect(a.columnIsVisible('containers', 'cpu')).toBe(true)
  })
  it('restores preferences on a fresh application load', async () => {
    const m = await import('./useTableColumns')
    m.setColumnVisible('pods', 'cpu', false)
    vi.resetModules()
    const fresh = await import('./useTableColumns')
    expect(fresh.columnIsVisible('pods', 'cpu')).toBe(false)
    expect(fresh.columnIsVisible('pods', 'new-column')).toBe(true)
  })
  it('resets only the chosen table', async () => {
    const m = await import('./useTableColumns')
    m.setColumnVisible('pods', 'cpu', false)
    m.setColumnVisible('images', 'size', false)
    m.resetColumns('pods')
    expect(m.columnIsVisible('pods', 'cpu')).toBe(true)
    expect(m.columnIsVisible('images', 'size')).toBe(false)
  })
  it('handles corrupt storage and ignores invalid entries', async () => {
    localStorage.setItem('uniterm:table-columns:v1:bad', '{')
    localStorage.setItem('uniterm:table-columns:v1:valid', '["cpu",null,5,"cpu"]')
    const m = await import('./useTableColumns')
    expect(m.hiddenColumns('bad')).toEqual([])
    expect(m.hiddenColumns('valid')).toEqual(['cpu'])
  })
  it('continues to work when browser storage is blocked or full', async () => {
    vi.stubGlobal('localStorage', { getItem: () => { throw Error('blocked') }, setItem: () => { throw Error('full') }, removeItem: () => { throw Error('blocked') } })
    const m = await import('./useTableColumns')
    m.setColumnVisible('pods', 'cpu', false)
    expect(m.columnIsVisible('pods', 'cpu')).toBe(false)
    m.resetColumns('pods')
    expect(m.columnIsVisible('pods', 'cpu')).toBe(true)
  })
  it('clears sorting and filters and requests a layout after columns change', async () => {
    const m = await import('./useTableColumns')
    const { nextTick } = await import('vue')
    const table = { clearSort: vi.fn(), clearFilter: vi.fn(), doLayout: vi.fn() }
    m.useTableColumns().refreshColumnLayout(table)
    expect(table.clearSort).toHaveBeenCalledOnce()
    expect(table.clearFilter).toHaveBeenCalledOnce()
    await nextTick()
    expect(table.doLayout).toHaveBeenCalledOnce()
  })
})
