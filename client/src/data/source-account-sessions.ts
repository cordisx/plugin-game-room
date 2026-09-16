import { type HttpTransport, object, string } from './http.js'
import { normalizeSourceUrl, type Source } from './model.js'
/** Display profiles never authenticate: the Host validates actual Native identity privately. */
export class SourceAccountSessions {
  private epochs = new Map<string, number>()
  epoch(sourceId: string) {
    return this.epochs.get(sourceId) ?? 0
  }
  advance(sourceId: string) {
    const epoch = this.epoch(sourceId) + 1
    this.epochs.set(sourceId, epoch)
    return epoch
  }
  private generation = 0
  retire() {
    this.generation++
    for (const sourceId of this.epochs.keys()) this.advance(sourceId)
  }
  capture(sourceId: string) {
    return { generation: this.generation, epoch: this.epoch(sourceId), http: this.http() }
  }
  valid(sourceId: string, lease: ReturnType<SourceAccountSessions['capture']>) {
    return this.generation === lease.generation && this.epoch(sourceId) === lease.epoch && this.http() === lease.http
  }
  private managed = new Set<string>()
  readonly paused = new Set<string>()
  constructor(
    private source: (id: string) => Source,
    private http: () => HttpTransport,
    private localDefault: boolean,
  ) {}
  hasManagedBinding(sourceId: string) {
    return this.managed.has(sourceId)
  }
  usesCodexAccount(sourceId: string) {
    const host = new URL(normalizeSourceUrl(this.source(sourceId).url)).hostname
    return this.managed.has(sourceId) || (this.localDefault && (host === '127.0.0.1' || host === '[::1]'))
  }
  discover(source: Source, managed: unknown) {
    this.managed.delete(source.id)
    if (!managed) return
    const advertised = object(managed)
    const binding = object(advertised.binding)
    if (
      advertised.contract !== 'cordisx.managed-source/v1' || binding.origin !== normalizeSourceUrl(source.url)
      || binding.sourceId !== source.id || binding.instanceId !== source.id || binding.audience !== 'source-account'
    ) {
      throw new Error('来源 Codex 登录绑定不一致')
    }
    this.managed.add(source.id)
  }
  async login(source: Source, signal: AbortSignal) {
    if (!this.managed.has(source.id)) throw new Error('此本地来源尚未配置受信 Codex 登录')
    const generation = this.generation
    const epoch = this.epoch(source.id)
    const http = this.http()
    if (!http.connectAccount) throw new Error('当前 Host 不支持 Codex 账户登录')
    const value = await http.connectAccount(source, signal)
    signal.throwIfAborted()
    if (this.generation !== generation || this.epoch(source.id) !== epoch || this.http() !== http) {
      throw new Error('授权已被替换')
    }
    const account = object(object(value).account)
    if (account.guest !== false) throw new Error('Codex 登录不能降级为访客')
    const accountId = string(account.id)
    if (source.accountId && source.accountId !== accountId) throw new Error('此凭证与配置账户不一致')
    return accountId
  }
}
