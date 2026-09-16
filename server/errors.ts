export class ApiError extends Error {
  constructor(public status: number, public code: string, message = code) {
    super(message)
  }
}
export function requireThat(value: unknown, code = 'invalid_request', status = 400): asserts value {
  if (!value) throw new ApiError(status, code)
}
export function object(value: unknown): asserts value is Record<string, unknown> {
  requireThat(value !== null && typeof value === 'object' && !Array.isArray(value))
}
export function integer(value: unknown, min: number, max: number): value is number {
  return Number.isSafeInteger(value) && (value as number) >= min && (value as number) <= max
}
export function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']'
  return '{'
    + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical((value as Record<string, unknown>)[k]))
      .join(',')
    + '}'
}
