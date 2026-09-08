import type { HttpClientV1, HttpConnectionV1 } from '@cordisx/protocol/plugin-http/v1'
import type { Source } from './model.js'
import { normalizeSourceUrl } from './model.js'
import { RequestFailure } from './http.js'
import type { HttpRequest, HttpTransport } from './http.js'
/** Connections are source+account scoped, even when game and economy share an origin. */
export class HostHttpTransport implements HttpTransport {
  private connections = new Map<string, HttpConnectionV1>()
  private derived = new Map<string, { sourceId: string; connection: HttpConnectionV1 }>()
  private publicConnections = new Map<string, Promise<void>>()
  private disposed = false
  constructor(private client: HttpClientV1) {}
  private key(source: Source, authenticated: boolean) {
    return JSON.stringify([source.id, source.accountId, normalizeSourceUrl(source.url), authenticated])
  }
  async connect(source: Source, credential: 'none' | 'bearer'): Promise<void> {
    if (this.disposed) throw new Error('连接已关闭')
    const result = await this.client.authorize({ origin: normalizeSourceUrl(source.url), credential })
    if (result.status !== 'accepted') throw new Error(`无法连接来源：${result.code}`)
    if (this.disposed) {
      await this.client.revoke(result.value)
      return
    }
    const key = this.key(source, credential === 'bearer')
    const previous = this.connections.get(key)
    this.connections.set(key, result.value)
    if (previous) await this.client.revoke(previous)
  }
  async disconnect(source: Source): Promise<void> {
    for (const authenticated of [false, true]) {
      const key = this.key(source, authenticated)
      const connection = this.connections.get(key)
      this.connections.delete(key)
      if (connection) await this.client.revoke(connection)
    }
  }
  async request(request: HttpRequest): Promise<unknown> {
    request.signal.throwIfAborted()
    if (this.disposed) throw new Error('连接已关闭')
    if (
      !request.authenticated && !this.connections.has(this.key(request.source, false))
      && !this.connections.has(this.key(request.source, true))
    ) {
      const key = this.key(request.source, false)
      const opening = this.publicConnections.get(key)
        ?? this.connect(request.source, 'none').finally(() => this.publicConnections.delete(key))
      this.publicConnections.set(key, opening)
      await opening
      request.signal.throwIfAborted()
    }
    const connection = this.connections.get(this.key(request.source, request.authenticated === true))
      ?? (!request.authenticated ? this.connections.get(this.key(request.source, true)) : undefined)
    if (!connection) throw new Error('请在设置中连接此来源账户')
    const result = await this.client.request({
      connection,
      path: request.path,
      method: request.method ?? 'GET',
      headers: {
        accept: 'application/json',
        ...(request.idempotencyKey ? { 'idempotency-key': request.idempotencyKey } : {}),
        ...(request.body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(request.body === undefined ? {} : { body: JSON.stringify(request.body) }),
      deadline: Date.now() + 15000,
      signal: request.signal,
    })
    request.signal.throwIfAborted()
    if (result.status !== 'accepted') throw new Error(`来源请求失败：${result.code}`)
    if (request.format === 'text' && result.value.statusCode >= 200 && result.value.statusCode < 300) {
      return result.value.body
    }
    let body: unknown
    try {
      body = JSON.parse(result.value.body)
    } catch {
      throw new Error('服务器没有返回有效 JSON')
    }
    if (result.value.statusCode < 200 || result.value.statusCode >= 300) {
      const code = body && typeof body === 'object' && 'error' in body
        ? (body as { error?: { code?: unknown } }).error?.code
        : undefined
      throw new RequestFailure(
        typeof code === 'string' ? code : `来源返回 HTTP ${result.value.statusCode}`,
        result.value.statusCode < 500 ? 'rejected' : 'uncertain',
      )
    }
    return body
  }
  async exchange(request: HttpRequest, credentialField: string): Promise<{ credentialRef: string; value: unknown }> {
    const parent = this.connections.get(this.key(request.source, true))
    if (this.disposed || !parent || typeof this.client.exchange !== 'function') {
      throw new Error('当前 Host 不支持安全席位授权交换')
    }
    const result = await this.client.exchange({
      connection: parent,
      path: request.path,
      credentialField,
      body: JSON.stringify(request.body),
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      deadline: Date.now() + 15000,
      signal: request.signal,
    })
    if (result.status !== 'accepted') throw new Error(`席位授权交换失败：${result.code}`)
    if (this.disposed || request.signal.aborted) {
      await this.client.revoke(result.value.connection)
      throw new Error('席位授权已取消')
    }
    const response = result.value.response
    if (response.statusCode < 200 || response.statusCode >= 300) {
      await this.client.revoke(result.value.connection)
      throw new RequestFailure(`席位授权被拒绝 HTTP ${response.statusCode}`, 'rejected')
    }
    let value: unknown
    try {
      value = JSON.parse(response.body)
    } catch {
      await this.client.revoke(result.value.connection)
      throw new Error('席位授权响应不是有效 JSON')
    }
    if (value && typeof value === 'object' && Object.hasOwn(value, credentialField)) {
      await this.client.revoke(result.value.connection)
      throw new Error('Host 未移除敏感授权字段')
    }
    const connection = result.value.connection
    this.derived.set(connection.id, { sourceId: request.source.id, connection })
    return { credentialRef: connection.id, value }
  }
  async requestCredential(
    request: HttpRequest & { credentialRef: string },
  ): Promise<{ status: number; body: unknown }> {
    const derived = this.derived.get(request.credentialRef)
    if (
      this.disposed || !derived || derived.sourceId !== request.source.id
      || derived.connection.origin !== normalizeSourceUrl(request.source.url)
    ) throw new Error('席位凭证来源不一致或已撤销')
    const response = await this.client.request({
      connection: derived.connection,
      path: request.path,
      method: request.method ?? 'GET',
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      ...(request.body === undefined ? {} : { body: JSON.stringify(request.body) }),
      deadline: Date.now() + 15000,
      signal: request.signal,
    })
    if (response.status !== 'accepted') throw new Error(`席位请求失败：${response.code}`)
    if (request.path === '/v1/agent/revoke' && response.value.statusCode >= 200 && response.value.statusCode < 300) {
      this.derived.delete(request.credentialRef)
      await this.client.revoke(derived.connection)
    }
    return { status: response.value.statusCode, body: JSON.parse(response.value.body) }
  }
  async dispose() {
    this.disposed = true
    const owned = [...this.connections.values(), ...[...this.derived.values()].map(value => value.connection)]
    this.publicConnections.clear()
    this.connections.clear()
    this.derived.clear()
    await Promise.allSettled(owned.map(connection => this.client.revoke(connection)))
  }
}
