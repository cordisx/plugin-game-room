import { type ReactNode, useEffect, useRef, useState } from 'cordisx/react'
import { Button } from 'cordisx/ui'
import { Symbol } from './icons.js'
import type { Seat, Source } from '../data/model.js'
import { resolveRoomDetailLayout } from './room-detail-layout.js'
import { RoomDetailsPane } from './room-details-pane.js'
import { RoomSummary } from './room-summary.js'
import '../styles/rules-bots.css'
import '../styles/prepare-drawer.css'

export function PreparePanel({ seat, detailsOpen, closeDetails, busy, sources, bots, surface, closeRoom }: {
  seat: Seat
  detailsOpen: boolean
  closeDetails: () => void
  busy: boolean
  sources: readonly Source[]
  bots?: (change: { add: true; seatIndex: number } | { removeSeatId: string }) => void
  closeRoom?: () => void
  surface: ReactNode
}) {
  const [confirmClose, setConfirmClose] = useState(false)
  const root = useRef<HTMLElement>(null)
  const [availableWidth, setAvailableWidth] = useState(0)
  useEffect(() => {
    const element = root.current
    if (!element) return
    const update = () => setAvailableWidth(element.getBoundingClientRect().width)
    update()
    const observer = new ResizeObserver(update)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  const layout = resolveRoomDetailLayout(availableWidth, seat.room.game.minimumViewport?.width)
  return (
    <section ref={root} className='gr-room-play' aria-label='游戏与席位状态'>
      <RoomDetailsPane
        open={detailsOpen}
        mode={layout.mode}
        paneWidth={layout.paneWidth}
        close={closeDetails}
        game={surface}
      >
        <RoomSummary room={seat.room} sources={sources} busy={busy} bots={bots} />
        {seat.canCloseRoom && closeRoom && (
          <div className='gr-room-owner-actions'>
            {confirmClose
              ? (
                <div className='gr-room-close-confirm' role='group' aria-label='确认关闭房间' aria-busy={busy}>
                  <span>关闭后所有玩家将退出</span>
                  <Button variant='ghost' disabled={busy} onClick={() => setConfirmClose(false)}>取消</Button>
                  <Button className='gr-room-close-submit' variant='ghost' disabled={busy} onClick={closeRoom}>
                    {busy ? '关闭中…' : '关闭房间'}
                  </Button>
                </div>
              )
              : (
                <Button variant='ghost' disabled={busy} onClick={() => setConfirmClose(true)}>
                  <Symbol name='close' size={16} />
                  关闭房间
                </Button>
              )}
          </div>
        )}
      </RoomDetailsPane>
    </section>
  )
}
