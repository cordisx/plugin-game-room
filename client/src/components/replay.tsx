import type { ReactElement } from 'cordisx/react'
import { useState } from 'cordisx/react'
import { Button } from 'cordisx/ui'
import type { RestrictedContentV1 } from '@cordisx/protocol/restricted-content/v1'
import type { ReplayEvent } from '../data/model.js'
import type { GameRoomPort } from '../data/port.js'
import { GameSurface } from './game-surface.js'
/** Replay keeps the original owned-seat projection and disables every author action. */
function readOnly(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value
  const node = value as Record<string, unknown>
  if (node.type === 'number-action') return { type: 'text', text: `${node.label}: ${node.value}` }
  return {
    ...node,
    ...(node.type === 'button' ? { disabled: true } : {}),
    ...(Array.isArray(node.children) ? { children: node.children.map(readOnly) } : {}),
    ...(node.root ? { root: readOnly(node.root) } : {}),
  }
}
export function ReplayPanel(
  { events, port, service }: { events: ReplayEvent[]; port: GameRoomPort; service?: RestrictedContentV1 },
): ReactElement {
  const [index, setIndex] = useState(0)
  const event = events[index]
  return (
    <div className='gr-detail'>
      <div className='gr-action-row'>
        <Button disabled={index === 0} onClick={() => setIndex(index - 1)}>上一步</Button>
        <span>{index + 1} / {events.length} · {event?.description}</span>
        <Button disabled={index >= events.length - 1} onClick={() => setIndex(index + 1)}>下一步</Button>
      </div>
      {event?.seat && (
        <GameSurface
          key={`${event.seat.matchId}/${event.turn}`}
          seat={{ ...event.seat, status: 'finished', scene: readOnly(event.seat.scene) }}
          port={port}
          service={service}
          changed={() => {}}
        />
      )}
      {!event && <p>暂无可回放事件</p>}
    </div>
  )
}
