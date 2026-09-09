/** Game actions are generic JSON. Host scene validation and server rules decide legal moves. */
export function validateActionData(value: unknown): void {
  function visit(value: unknown, depth: number): void {
    if (depth > 16) throw new Error('动作嵌套过深')
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return
    if (typeof value === 'number' && Number.isFinite(value)) return
    if (Array.isArray(value)) {
      for (const item of value) visit(item, depth + 1)
      return
    }
    if (value && typeof value === 'object' && [Object.prototype, null].includes(Object.getPrototypeOf(value))) {
      for (const item of Object.values(value)) visit(item, depth + 1)
      return
    }
    throw new Error('动作必须为纯 JSON 数据')
  }
  visit(value, 0)
  if (new TextEncoder().encode(JSON.stringify(value)).byteLength > 4096) throw new Error('动作超过大小限制')
}
