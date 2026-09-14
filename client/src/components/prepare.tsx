import { type ReactNode, useEffect, useRef, useState } from 'cordisx/react'
import type { Seat, Source } from '../data/model.js'
import { resolveRoomDetailLayout } from './room-detail-layout.js'
import { RoomDetailsPane } from './room-details-pane.js'
import { RoomSummary } from './room-summary.js'
import '../styles/rules-bots.css'
import '../styles/prepare-drawer.css'

export function PreparePanel({ seat, detailsOpen, closeDetails, busy, sources, bots, surface }: {
  seat: Seat
  detailsOpen: boolean
  closeDetails: () => void
  busy: boolean
  sources: readonly Source[]
  bots?: (change: { add: true; seatIndex: number } | { removeSeatId: string }) => void
  surface: ReactNode
}) {
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
      </RoomDetailsPane>
    </section>
  )
}
