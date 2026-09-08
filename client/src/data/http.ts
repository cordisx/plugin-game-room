import type { Source } from './model.js'
export type HttpRequest = {
  source: Source
  path: string
  method?: 'GET' | 'POST' | 'DELETE'
  body?: unknown
  signal: AbortSignal
  format?: 'json' | 'text'
  authenticated?: boolean
  idempotencyKey?: string
}
/** Implemented by the public Host network capability; never resolve credential handles in React. */
export interface HttpTransport {
  exchange?(request: HttpRequest, credentialField: string): Promise<{ credentialRef: string; value: unknown }>
  requestCredential?(request: HttpRequest & { credentialRef: string }): Promise<{ status: number; body: unknown }>
  disconnect?(source: Source): Promise<void>
  connect?(source: Source, credential: 'none' | 'bearer'): Promise<void>
  request(request: HttpRequest): Promise<unknown>
  dispose(): void | Promise<void>
}
export class PublicDiscoveryTransport implements HttpTransport {
  async request(request: HttpRequest): Promise<unknown> {
    if (request.authenticated) throw new Error('此运行环境尚未提供安全账户连接，请在支持网络凭证的 Host 中连接')
    const base = new URL(request.source.url)
    const url = new URL(request.path, base)
    if (url.origin !== base.origin) throw new Error('请求不能跳转到其他来源')
    const response = await fetch(url, {
      method: request.method ?? 'GET',
      signal: request.signal,
      redirect: 'error',
      credentials: 'omit',
      headers: { Accept: 'application/json' },
    })
    if (!response.ok) throw new Error(`来源返回 HTTP ${response.status}`)
    const text = await response.text()
    if (text.length > 2_000_000) throw new Error('来源响应超过大小限制')
    return request.format === 'text' ? text : JSON.parse(text)
  }
  dispose() {}
}
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('服务器响应格式不兼容')
  return value as Record<string, unknown>
}
export function string(value: unknown): string {
  if (typeof value !== 'string') throw new Error('服务器字符串字段不兼容')
  return value
}
export function number(value: unknown): number {
  if (!Number.isFinite(value)) throw new Error('服务器数字字段不兼容')
  return value as number
}
export function array(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error('服务器列表字段不兼容')
  return value
}

export class RequestFailure extends Error {
  constructor(message: string, readonly outcome: 'rejected' | 'uncertain') {
    super(message)
  }
}
