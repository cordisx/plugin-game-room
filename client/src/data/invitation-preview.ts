import type { GameRoomPort } from './port.js'
import { decodeInvitation } from './model.js'
/** Read-only preview. Never occupies a seat or silently switches sources. */
export async function readInvitation(port: GameRoomPort, text: string, signal: AbortSignal) {
  const invitation = decodeInvitation(text, port.sources)
  const source = port.sources.find(source => source.id === invitation.sourceId)!
  const snapshot = await port.list(source, signal)
  signal.throwIfAborted()
  if (!snapshot.compatible) throw new Error(snapshot.reason ?? '来源协议不兼容')
  const room = snapshot.rooms.find(room => room.id === invitation.roomId && room.sourceId === invitation.sourceId)
  if (!room) throw new Error('房间不存在或已不可见')
  if (!room.compatible) throw new Error(room.compatibilityReason ?? '房间版本不兼容')
  if (room.owned) return { invitation, room, source }
  if (room.state !== 'waiting') throw new Error(room.state === 'playing' ? '房间正在对局，暂不可加入' : '房间已结束')
  if (room.occupied >= room.capacity) throw new Error('房间已满')
  return { invitation, room, source }
}
