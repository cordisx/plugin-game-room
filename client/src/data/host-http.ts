import type { HttpClientV1, HttpConnectionV1 } from '@cordisx/protocol/plugin-http/v1'
import type { HttpClientV2, HttpSessionScopeV2 } from '@cordisx/protocol/plugin-http/v2'
import type { HttpClientV3 } from '@cordisx/protocol/plugin-http/v3'
import type { HttpClientV4 } from '@cordisx/protocol/plugin-http/v4'
import type { Source } from './model.js'
import { normalizeSourceUrl } from './model.js'
import { RequestFailure } from './http.js'
import type { HttpRequest, HttpTransport } from './http.js'
/** Game sessions are source/account scoped. Local wallet operations use the separate spend capability. */
export class HostHttpTransport implements HttpTransport {
  private connections = new Map<string, HttpConnectionV1>()
  private derived = new Map<string, { sourceId: string; connection: HttpConnectionV1 }>()
  private publicConnections = new Map<string, Promise<void>>()
  private disposed = false
  private identities = new Map<string, string>()
  private quarantined = new Set<string>()
  private resumes = new Map<string, Promise<unknown | undefined>>()
  private epochs = new Map<string, number>()
  private storage = new Map<string, Promise<void>>()
  private epoch(key: string) {
    return this.epochs.get(key) ?? 0
  }
  private advance(key: string) {
    const epoch = this.epoch(key) + 1
    this.epochs.set(key, epoch)
    return epoch
  }
  private store(key: string, action: () => Promise<void>) {
    const pending = (this.storage.get(key) ?? Promise.resolve()).catch(() => {}).then(action)
    this.storage.set(key, pending)
    return pending
  }
  private wait<T>(pending: Promise<T>, signal: AbortSignal, deadline: number): Promise<T> {
    signal.throwIfAborted()
    if (Date.now() >= deadline) return Promise.reject(new Error('来源请求已超时'))
    return new Promise((resolve, reject) => {
      const finish = (action: () => void) => {
        clearTimeout(timer)
        signal.removeEventListener('abort', abort)
        action()
      }
      const abort = () => finish(() => reject(signal.reason))
      const timer = setTimeout(
        () => finish(() => reject(new Error('来源请求已超时'))),
        Math.max(0, deadline - Date.now()),
      )
      signal.addEventListener('abort', abort, { once: true })
      pending.then(
        value => finish(() => Date.now() >= deadline ? reject(new Error('来源请求已超时')) : resolve(value)),
        error => finish(() => reject(error)),
      )
    })
  }
  private guestConnections = new Map<string, Promise<void>>()
  constructor(private client: HttpClientV1 | HttpClientV2 | HttpClientV3 | HttpClientV4) {}
  private get persistent() {
    return this.client.contract === 'cordisx.http-client/v2' || this.client.contract === 'cordisx.http-client/v3'
        || this.client.contract === 'cordisx.http-client/v4'
      ? this.client
      : undefined
  }
  private scope(source: Source): HttpSessionScopeV2 {
    return { origin: normalizeSourceUrl(source.url), sourceId: source.id, accountId: source.accountId ?? '' }
  }
  private async retain(source: Source, connection: HttpConnectionV1) {
    const client = this.persistent
    if (!client) return
    const { sourceId, accountId } = this.scope(source)
    const result = await client.retain(connection, { sourceId, accountId })
    if (result.status !== 'accepted') {
      await this.client.revoke(connection)
      throw new Error(`会话安全保存失败：${result.code}`)
    }
  }
  private async forget(source: Source) {
    const result = await this.persistent?.forget(this.scope(source))
    if (result && result.status !== 'accepted') throw new Error(`会话安全清除失败：${result.code}`)
  }
  private key(source: Source, authenticated: boolean) {
    return JSON.stringify([source.id, source.accountId, normalizeSourceUrl(source.url), authenticated])
  }
  async connect(source: Source, credential: 'none' | 'bearer'): Promise<void> {
    if (this.disposed) throw new Error('连接已关闭')
    const key = this.key(source, credential === 'bearer')
    const epoch = credential === 'bearer' ? this.advance(key) : this.epoch(key)
    const result = await this.client.authorize({ origin: normalizeSourceUrl(source.url), credential })
    if (result.status !== 'accepted') throw new Error(`无法连接来源：${result.code}`)
    if (this.disposed) {
      await this.client.revoke(result.value)
      return
    }
    if (this.epoch(key) !== epoch) {
      await this.client.revoke(result.value)
      throw new Error('授权已被替换')
    }
    let retained = false
    try {
      const previous = this.connections.get(key)
      if (previous) {
        this.connections.delete(key)
        await this.client.revoke(previous)
      }
      if (this.disposed) throw new Error('连接已关闭')
      if (this.epoch(key) !== epoch) throw new Error('授权已被替换')
      if (credential === 'bearer') {
        await this.store(key, async () => {
          if (this.epoch(key) !== epoch || this.disposed) throw new Error('授权已被替换')
          await this.retain(source, result.value)
          retained = !!this.persistent
        })
      }
      if (this.epoch(key) !== epoch) throw new Error('授权已被替换')
      if (this.disposed) throw new Error('连接已关闭')
      if (credential === 'bearer') this.identities.delete(key)
      this.connections.set(key, result.value)
    } catch (error) {
      // Retained descriptors belong to Host: revoking one could erase the saved scope.
      if (!retained) await this.client.revoke(result.value)
      throw error
    }
  }

  async restoreSession(
    source: Source,
    signal: AbortSignal,
    deadline = Date.now() + 15000,
  ): Promise<unknown | undefined> {
    signal.throwIfAborted()
    if (Date.now() >= deadline) throw new Error('来源请求已超时')
    if (this.disposed) throw new Error('连接已关闭')
    const key = this.key(source, true)
    const connection = this.connections.get(key)
    if (connection) return this.validateSession(source, connection, signal, deadline, this.epoch(key), false)
    // Local grants are reopened only by the explicit local authority API, never v2 resume.
    if (!this.persistent) return undefined
    let pending = this.resumes.get(key)
    if (!pending) {
      const client = this.persistent
      const epoch = this.epoch(key)
      // Recovery belongs to the adapter; each waiter retains its own cancellation/deadline.
      const controller = new AbortController()
      const sharedDeadline = Date.now() + 15000
      const timer = setTimeout(() => controller.abort(new Error('来源请求已超时')), 15000)
      pending = (async () => {
        const resumed = await this.wait(client.resume(this.scope(source)), controller.signal, sharedDeadline)
        if (resumed.status !== 'accepted') throw new Error(`会话恢复失败：${resumed.code}`)
        if (!resumed.value) return undefined
        if (this.disposed) throw new Error('连接已关闭')
        if (this.epoch(key) !== epoch) throw new Error('授权已被替换')
        const current = this.connections.get(key)
        if (current) {
          return this.wait(
            this.validateSession(source, current, controller.signal, sharedDeadline, epoch, false),
            controller.signal,
            sharedDeadline,
          )
        }
        const value = await this.wait(
          this.validateSession(source, resumed.value, controller.signal, sharedDeadline, epoch, true),
          controller.signal,
          sharedDeadline,
        )
        if (this.disposed) throw new Error('连接已关闭')
        if (this.epoch(key) !== epoch) throw new Error('授权已被替换')
        if (value !== undefined && !this.connections.has(key)) this.connections.set(key, resumed.value)
        return value
      })().finally(() => {
        clearTimeout(timer)
        if (this.resumes.get(key) === pending) this.resumes.delete(key)
      })
      this.resumes.set(key, pending)
    }
    return this.wait(pending, signal, deadline)
  }
  private async validateSession(
    source: Source,
    connection: HttpConnectionV1,
    signal: AbortSignal,
    deadline: number,
    epoch: number,
    provisional: boolean,
  ) {
    try {
      return await this.perform(
        { source, path: '/v1/me', authenticated: true, signal },
        deadline,
        false,
        connection,
        epoch,
      )
    } catch (error) {
      signal.throwIfAborted()
      const key = this.key(source, true)
      if (!(error instanceof RequestFailure) || error.outcome !== 'rejected') throw error
      if (error.message === 'session_unavailable' && this.persistent) throw error
      if (!['invalid_session', 'authentication_required', 'session_unavailable'].includes(error.message)) throw error
      await this.store(key, async () => {
        if (this.epoch(key) !== epoch || this.disposed) return
        const current = this.connections.get(key)
        if (current !== connection && (!provisional || current)) return
        this.connections.delete(key)
        this.identities.delete(key)
        await this.forget(source)
        await this.client.revoke(connection)
      })
      return undefined
    }
  }
  retireSessions() {
    // Display changes retire remote sessions; local authority belongs to Host's profile key.
    for (
      const key of new Set([...this.connections.keys(), ...this.managedConnections.keys(), ...this.resumes.keys()])
    ) {
      this.advance(key)
      this.connections.delete(key)
      this.identities.delete(key)
      this.managedConnections.delete(key)
      this.resumes.delete(key)
    }
    for (const value of this.derived.values()) void this.client.revoke(value.connection)
    this.derived.clear()
  }
  private managedWaiters = new Map<Promise<unknown>, number>()
  private managedConnections = new Map<string, Promise<unknown>>()
  async connectAccount(source: Source, signal: AbortSignal): Promise<unknown> {
    return this.connectManagedAccount(source, source.id, signal)
  }
  private async connectManagedAccount(
    source: Source,
    instanceId: string,
    signal: AbortSignal,
  ): Promise<unknown> {
    if (this.client.contract !== 'cordisx.http-client/v3' && this.client.contract !== 'cordisx.http-client/v4') {
      throw new Error('当前 Host 不支持 Codex 账户登录')
    }
    signal.throwIfAborted()
    if (this.disposed) throw new Error('连接已关闭')
    const key = this.key(source, true)
    let pending = this.managedConnections.get(key)
    if (!pending) {
      const client = this.client
      const epoch = this.advance(key)
      pending = (async () => {
        const deadline = Date.now() + 15000
        const resumed = await this.wait(client.resume(this.scope(source)), new AbortController().signal, deadline)
        if (resumed.status !== 'accepted') throw new Error(`会话恢复失败：${resumed.code}`)
        const previous = resumed.value ?? undefined
        if (this.disposed || this.epoch(key) !== epoch || Date.now() >= deadline) throw new Error('授权已被替换')
        const result = await client.connectAccount({
          origin: normalizeSourceUrl(source.url),
          sourceId: source.id,
          instanceId,
          audience: 'source-account',
          ...(source.accountDisplayName?.trim() ? { displayName: source.accountDisplayName.trim() } : {}),
          ...(previous ? { previousConnection: previous } : {}),
        })
        if (result.status !== 'accepted') throw new Error(`Codex 账户连接失败：${result.code}`)
        let retained = false
        try {
          if (this.disposed || this.epoch(key) !== epoch || Date.now() >= deadline) throw new Error('授权已被替换')
          const response = result.value.response
          const body = JSON.parse(response.body)
          if (
            response.statusCode !== 200 || body.instanceId !== instanceId
            || body.account?.guest !== false
            || typeof body.account.id !== 'string' || Object.hasOwn(body, 'sessionToken')
            || Object.hasOwn(body, 'token')
            || result.value.connection.origin !== normalizeSourceUrl(source.url)
            || result.value.connection.credential !== 'bearer'
          ) throw new Error('Codex 账户响应不兼容')
          if (source.accountId && source.accountId !== body.account.id) throw new Error('此凭证与配置账户不一致')
          {
            await this.store(key, async () => {
              if (this.disposed || this.epoch(key) !== epoch || Date.now() >= deadline) throw new Error('授权已被替换')
              await this.retain(source, result.value.connection)
              retained = true
            })
          }
          if (this.disposed || this.epoch(key) !== epoch || Date.now() >= deadline) throw new Error('授权已被替换')
          this.identities.delete(key)
          this.connections.set(key, result.value.connection)
          return body
        } catch (error) {
          if (!retained) await this.client.revoke(result.value.connection)
          throw error
        }
      })().finally(() => {
        if (this.managedConnections.get(key) === pending) this.managedConnections.delete(key)
      })
      this.managedConnections.set(key, pending)
    }
    const shared = pending
    const deadline = Date.now() + 15000
    this.managedWaiters.set(shared, (this.managedWaiters.get(shared) ?? 0) + 1)
    let cancelled = false
    try {
      return await this.wait(shared, signal, deadline)
    } catch (error) {
      cancelled = signal.aborted || Date.now() >= deadline
      throw error
    } finally {
      const remaining = (this.managedWaiters.get(shared) ?? 1) - 1
      if (remaining) this.managedWaiters.set(shared, remaining)
      else {
        this.managedWaiters.delete(shared)
        if (cancelled && this.managedConnections.get(key) === shared) {
          this.advance(key)
          this.managedConnections.delete(key)
        }
      }
    }
  }
  async connectGuest(source: Source, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted()
    const key = this.key(source, true)
    let pending = this.guestConnections.get(key)
    if (!pending) {
      pending = this.openGuest(source, signal).finally(() => this.guestConnections.delete(key))
      this.guestConnections.set(key, pending)
    }
    await pending
    signal.throwIfAborted()
  }
  private async openGuest(source: Source, signal: AbortSignal): Promise<void> {
    if (await this.restoreSession(source, signal) !== undefined) return
    await this.prepare(source, signal)
    if (!this.connections.has(this.key(source, false))) await this.connect(source, 'none')
    const parent = this.connections.get(this.key(source, false))
    if (!parent || typeof this.client.exchange !== 'function') throw new Error('当前 Host 不支持访客会话交换')
    const authKey = this.key(source, true)
    const epoch = this.advance(authKey)
    const result = await this.client.exchange({
      connection: parent,
      path: '/v1/guests',
      credentialField: 'token',
      body: '{}',
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      deadline: Date.now() + 15000,
      signal,
    })
    if (result.status !== 'accepted') throw new Error(`访客连接失败：${result.code}`)
    if (this.disposed || signal.aborted || this.epoch(authKey) !== epoch) {
      await this.client.revoke(result.value.connection)
      throw new Error('访客连接已取消')
    }
    try {
      const body = JSON.parse(result.value.response.body)
      if (result.value.response.statusCode !== 200 || !body?.account?.guest || Object.hasOwn(body, 'token')) {
        throw new Error('访客授权响应不兼容')
      }
    } catch (error) {
      await this.client.revoke(result.value.connection)
      throw error
    }
    const key = this.key(source, true)
    let retained = false
    try {
      const previous = this.connections.get(key)
      if (previous) await this.client.revoke(previous)
      await this.store(key, async () => {
        if (this.epoch(key) !== epoch || this.disposed) throw new Error('授权已被替换')
        signal.throwIfAborted()
        await this.retain(source, result.value.connection)
        retained = !!this.persistent
      })
      if (this.epoch(key) !== epoch) throw new Error('授权已被替换')
      signal.throwIfAborted()
      if (this.disposed) throw new Error('访客连接已取消')
      this.identities.delete(key)
      this.connections.set(key, result.value.connection)
    } catch (error) {
      if (!retained) await this.client.revoke(result.value.connection)
      throw error
    }
  }

  async disconnect(source: Source): Promise<void> {
    const authKey = this.key(source, true)
    const epoch = this.advance(authKey)
    let failure: unknown
    const captured = [false, true].map(authenticated => {
      const key = this.key(source, authenticated)
      return { key, connection: this.connections.get(key) }
    })
    try {
      const signal = new AbortController().signal
      if (await this.restoreSession(source, signal) !== undefined) {
        if (this.epoch(authKey) !== epoch) throw new Error('授权已被替换')
        const connection = this.connections.get(authKey)
        if (connection) {
          captured[1] = { key: authKey, connection }
          await this.perform(
            { source, path: '/v1/session', method: 'DELETE', authenticated: true, signal },
            Date.now() + 15000,
            false,
            connection,
            epoch,
          )
        }
      }
    } catch (error) {
      failure = error
    } finally {
      try {
        await this.store(authKey, async () => {
          if (this.epoch(authKey) === epoch) await this.forget(source)
        })
      } catch (error) {
        failure ??= error
      }
      for (const { key, connection } of captured) {
        if (this.epoch(authKey) !== epoch) break
        if (!connection || this.connections.get(key) !== connection) continue
        this.connections.delete(key)
        this.identities.delete(key)
        const result = await this.client.revoke(connection)
        if (this.epoch(authKey) !== epoch) break
        if (result.status !== 'accepted' && result.code !== 'connection-unavailable') {
          failure ??= new Error(`连接撤销失败：${result.code}`)
        }
      }
    }
    if (failure) throw failure
  }
  async prepare(source: Source, signal: AbortSignal, deadline = Date.now() + 15000): Promise<void> {
    signal.throwIfAborted()
    if (this.disposed) throw new Error('连接已关闭')
    if (this.connections.has(this.key(source, false)) || this.connections.has(this.key(source, true))) return
    const key = this.key(source, false)
    const opening = this.publicConnections.get(key)
      ?? this.connect(source, 'none').finally(() => this.publicConnections.delete(key))
    this.publicConnections.set(key, opening)
    await this.wait(opening, signal, deadline)
    signal.throwIfAborted()
  }
  request(request: HttpRequest): Promise<unknown> {
    return this.perform(request, Date.now() + 15000, true)
  }
  private async perform(
    request: HttpRequest,
    deadline: number,
    recover: boolean,
    candidate?: HttpConnectionV1,
    expectedEpoch?: number,
  ): Promise<unknown> {
    request.signal.throwIfAborted()
    if (this.disposed) throw new Error('连接已关闭')
    if (Date.now() >= deadline) throw new Error('来源请求已超时')
    if (!request.authenticated) await this.prepare(request.source, request.signal, deadline)
    const connection = candidate ?? this.connections.get(this.key(request.source, request.authenticated === true))
      ?? (!request.authenticated ? this.connections.get(this.key(request.source, true)) : undefined)
    if (!connection) throw new Error('请在设置中连接此来源账户')
    if (this.quarantined.has(connection.id)) throw new RequestFailure('session_identity_changed', 'rejected')
    const authKey = this.key(request.source, true)
    const epoch = expectedEpoch ?? this.epoch(authKey)
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
      deadline,
      signal: request.signal,
    })
    request.signal.throwIfAborted()
    if (request.authenticated && (this.epoch(authKey) !== epoch || this.disposed)) throw new Error('授权已被替换')
    if (result.status !== 'accepted') {
      if (['connection-unavailable', 'credential-unavailable'].includes(result.code)) {
        const key = this.key(request.source, connection.credential === 'bearer')
        if (this.connections.get(key) === connection) this.connections.delete(key)
        if (recover && (request.method ?? 'GET') === 'GET') {
          if (connection.credential === 'none') await this.prepare(request.source, request.signal, deadline)
          else {
            if (!this.persistent) throw new RequestFailure('session_unavailable', 'rejected')
            const session = await this.restoreSession(request.source, request.signal, deadline)
            if (session === undefined) throw new RequestFailure('session_unavailable', 'rejected')
            if (request.path === '/v1/me') {
              if (Date.now() >= deadline) throw new Error('来源请求已超时')
              return session
            }
          }
          return this.perform(request, deadline, false)
        }
        if (connection.credential === 'bearer') throw new RequestFailure('session_unavailable', 'rejected')
      }
      throw new Error(`来源请求失败：${result.code}`)
    }
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
      if (
        request.authenticated && result.value.statusCode === 401
        && (code === 'invalid_session' || code === 'authentication_required')
      ) {
        const key = this.key(request.source, true)
        if (!candidate) {
          await this.store(key, async () => {
            if (this.epoch(key) !== epoch || this.disposed || this.connections.get(key) !== connection) return
            this.connections.delete(key)
            this.identities.delete(key)
            await this.forget(request.source)
            await this.client.revoke(connection)
          })
        }
      }
      throw new RequestFailure(
        typeof code === 'string' ? code : `来源返回 HTTP ${result.value.statusCode}`,
        result.value.statusCode < 500 ? 'rejected' : 'uncertain',
      )
    }
    if (request.authenticated && request.path === '/v1/me') {
      const value = body as { account?: { id?: unknown }; instanceId?: unknown; accountId?: unknown }
      const accountId = value?.account?.id ?? value?.accountId
      if (typeof accountId !== 'string' || !accountId) throw new Error('服务器账户身份响应无效')
      const identity = JSON.stringify([accountId, value.instanceId ?? null])
      const key = this.key(request.source, true)
      const previous = this.identities.get(key)
      if ((request.source.accountId && request.source.accountId !== accountId) || (previous && previous !== identity)) {
        this.quarantined.add(connection.id)
        if (this.connections.get(key) === connection) this.connections.delete(key)
        throw new RequestFailure('session_identity_changed', 'rejected')
      }
      this.identities.set(key, identity)
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
    if (this.disposed) return
    this.disposed = true
    // ctx.http is borrowed from Host. Close only this adapter's transient grants;
    // Host owns shared client teardown and retained grants across activations.
    const transient = [
      ...[...this.connections].filter(([key, connection]) => !this.persistent || connection.credential === 'none').map((
        [, connection],
      ) => connection),
      ...[...this.derived.values()].map(value => value.connection),
    ]
    this.publicConnections.clear()
    this.guestConnections.clear()
    this.connections.clear()
    this.identities.clear()
    this.quarantined.clear()
    this.resumes.clear()
    this.derived.clear()
    await Promise.allSettled(transient.map(connection => this.client.revoke(connection)))
  }
}
