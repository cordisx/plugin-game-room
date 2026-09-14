import type { CurrentUserState } from './current-user-sync.js'
import type { Source } from './model.js'
export class SourceDisplayProfiles {
  private currentUser: CurrentUserState = { status: 'unavailable', reason: 'host-unavailable' }
  readonly supported = new Set<string>()
  private bindings = new Map<string, string>()
  private writes = new Map<string, string>()
  private controller = new AbortController()
  setCurrentUser(state: CurrentUserState) {
    this.controller.abort()
    this.controller = new AbortController()
    this.currentUser = state
  }
  reset(sourceId: string, accountId?: string) {
    this.writes.delete(sourceId)
    if (accountId) this.bindings.delete(accountId)
  }
  async sync(
    source: Source,
    accountId: string | undefined,
    signal: AbortSignal,
    write: (payload: unknown, signal: AbortSignal) => Promise<unknown>,
    managedAccount = false,
  ) {
    const state = this.currentUser
    if (!accountId || !this.supported.has(source.id) || (state.status !== 'available' && !managedAccount)) return
    const bound = this.bindings.get(accountId)
    if (state.status === 'available' && bound && bound !== state.subject) {
      throw new Error('当前游戏会话属于另一用户，请切换服务器连接后重试')
    }
    const displayName = source.accountDisplayName?.trim()
      || (state.status === 'available' ? state.displayName : undefined)
    const payload = {
      subject: state.status === 'available' ? state.subject : `source-account:${accountId}`,
      ...(displayName ? { displayName } : {}),
      ...(state.status === 'available' && state.avatar ? { avatar: state.avatar } : {}),
    }
    const fingerprint = JSON.stringify([accountId, payload])
    if (this.writes.get(source.id) === fingerprint) return
    const combined = AbortSignal.any([signal, this.controller.signal])
    await write(payload, combined)
    combined.throwIfAborted()
    if (this.currentUser !== state) return
    if (state.status === 'available') this.bindings.set(accountId, state.subject)
    this.writes.set(source.id, fingerprint)
  }
  dispose() {
    this.controller.abort()
  }
}
