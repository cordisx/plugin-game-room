import { useEffect, useState } from 'cordisx/react'
import { Button, EmptyState } from 'cordisx/ui'
import type { RestrictedContentV1 } from '@cordisx/protocol/restricted-content/v1'
import type { ReplayEvent } from '../data/model.js'
import type { GameRoomPort } from '../data/port.js'
import { readOnly, replayIndex } from '../data/replay-view.js'
import { GameSurface } from './game-surface.js'
import { Symbol } from './icons.js'
import '../styles/publish-replay.css'
export function ReplayPanel({ events, port, service, back }: {
  events: ReplayEvent[]
  port: GameRoomPort
  service?: RestrictedContentV1
  back: () => void
}) {
  const [index, setIndex] = useState(0)
  useEffect(() => setIndex(0), [events])
  const position = replayIndex(index, events.length)
  const event = events[position]
  return (
    <section className='gr-replay' aria-label='只读回放'>
      <div className='gr-replay-body'>
        {event?.seat
          ? (
            <GameSurface
              key={`${event.seat.matchId}/${event.turn}`}
              seat={{ ...event.seat, status: 'finished', scene: readOnly(event.seat.scene) }}
              port={port}
              service={service}
              changed={() => {}}
            />
          )
          : (
            <EmptyState
              title={event ? '此事件没有场景' : '暂无可回放事件'}
              description={event?.description ?? '返回战绩选择其他对局。'}
              action={<Button onClick={back}>返回战绩</Button>}
            />
          )}
      </div>
      <footer className='gr-replay-footer'>
        <Button variant='ghost' className='gr-square-button' aria-label='返回战绩' title='返回战绩' onClick={back}>
          <Symbol name='back' />
        </Button>
        <span>
          {events.length ? `${position + 1} / ${events.length}` : '0 / 0'}
          {event?.description ? ` · ${event.description}` : ''}
        </span>
        <div className='gr-action-row'>
          <Button
            variant='ghost'
            className='gr-square-button'
            aria-label='上一步'
            title='上一步'
            disabled={!event || position === 0}
            onClick={() => setIndex(position - 1)}
          >
            <Symbol name='back' />
          </Button>
          <Button
            variant='ghost'
            className='gr-square-button'
            aria-label='下一步'
            title='下一步'
            disabled={!event || position >= events.length - 1}
            onClick={() => setIndex(position + 1)}
          >
            <span className='gr-next-step'>
              <Symbol name='back' />
            </span>
          </Button>
        </div>
      </footer>
    </section>
  )
}
