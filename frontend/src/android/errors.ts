/** Wails errors can be Error instances, JSON objects, or strings. */
export function androidErrorMessage(error: unknown): string {
  if (typeof error === 'string' && error.trim()) return error
  if (error && typeof error === 'object') {
    const e = error as { message?: unknown; error?: unknown; cause?: unknown }
    if (typeof e.message === 'string' && e.message.trim()) return e.message
    if (typeof e.error === 'string' && e.error.trim()) return e.error
    if (typeof e.cause === 'string' && e.cause.trim()) return e.cause
  }
  return 'Android connection failed. Check the device address, wireless debugging and authorization, then retry.'
}
