import type { CurrentUserResultV1, CurrentUserV1 } from '@cordisx/protocol/current-user/v1'
type UnavailableReason = Extract<CurrentUserResultV1, { status: 'unavailable' }>['reason']
type PublicCurrentUserResult = CurrentUserResultV1
export type CurrentUserSource = Pick<CurrentUserV1, 'contract' | 'read' | 'subscribe'>

export type CurrentUserState =
  | { status: 'available'; subject: string; displayName?: string; avatar?: string }
  | { status: 'unavailable'; reason: UnavailableReason }

/** Only the bounded 96px inline PNG accepted by the public Host avatar contract reaches metadata. */
export function safeCurrentUserAvatar(avatar: unknown): string | undefined {
  if (typeof avatar !== 'string' || avatar.length > 65_536) return undefined
  const prefix = 'data:image/png;base64,'
  if (!avatar.startsWith(prefix)) return undefined
  const encoded = avatar.slice(prefix.length)
  if (!encoded || encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) return undefined
  try {
    const png = Uint8Array.from(atob(encoded), char => char.charCodeAt(0))
    const signature = [137, 80, 78, 71, 13, 10, 26, 10]
    if (png.length < 33 || signature.some((byte, index) => png[index] !== byte)) return undefined
    const view = new DataView(png.buffer)
    if (view.getUint32(8) !== 13 || String.fromCharCode(...png.slice(12, 16)) !== 'IHDR') return undefined
    if (view.getUint32(16) !== 96 || view.getUint32(20) !== 96) return undefined
    return avatar
  } catch {
    return undefined
  }
}

function normalize(result: PublicCurrentUserResult): CurrentUserState {
  if (result.status === 'unavailable') return { status: 'unavailable', reason: result.reason }
  const { subject, displayName, avatar } = result.profile
  if (typeof subject !== 'string' || !subject) return { status: 'unavailable', reason: 'host-unavailable' }
  const name = typeof displayName === 'string' ? displayName.trim().slice(0, 128) : ''
  const image = safeCurrentUserAvatar(avatar)
  return {
    status: 'available',
    subject,
    ...(name ? { displayName: name } : {}),
    ...(image ? { avatar: image } : {}),
  }
}

/** A subscription supersedes the pending read; cleanup retires every callback from this binding. */
export function syncCurrentUser(
  source: CurrentUserSource | undefined,
  changed: (state: CurrentUserState) => void,
): () => void {
  if (!source || source.contract !== 'cordisx.current-user/v1') {
    changed({ status: 'unavailable', reason: 'host-unavailable' })
    return () => {}
  }
  let active = true
  let revision = 0
  let unsubscribe = () => {}
  const publish = (result: PublicCurrentUserResult) => {
    if (!active) return
    revision++
    changed(normalize(result))
  }
  const readRevision = revision
  try {
    unsubscribe = source.subscribe(publish)
  } catch {
    publish({ status: 'unavailable', reason: 'host-unavailable' })
  }
  void Promise.resolve().then(() => source.read()).then(
    result => {
      if (active && revision === readRevision) publish(result)
    },
    () => {
      if (active && revision === readRevision) publish({ status: 'unavailable', reason: 'host-unavailable' })
    },
  )
  return () => {
    if (!active) return
    active = false
    unsubscribe()
  }
}
