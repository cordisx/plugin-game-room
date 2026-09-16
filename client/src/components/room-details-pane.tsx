import { type CSSProperties, type ReactNode, useEffect, useRef } from 'cordisx/react'
import { Button } from 'cordisx/ui'
import { Symbol } from './icons.js'
import type { RoomDetailLayoutMode } from './room-detail-layout.js'
import '../styles/room-details-pane.css'

export function RoomDetailsPane({ open, mode, paneWidth, close, game, children }: {
  open: boolean
  mode: RoomDetailLayoutMode
  paneWidth: number
  close: () => void
  game: ReactNode
  children: ReactNode
}) {
  const gameRoot = useRef<HTMLDivElement>(null)
  const paneRoot = useRef<HTMLElement>(null)
  useEffect(() => {
    if (open) requestAnimationFrame(() => document.getElementById('room-details-close')?.focus())
    else if (paneRoot.current?.contains(document.activeElement)) gameRoot.current?.focus()
  }, [open])
  return (
    <section
      className='gr-room-details-layout'
      data-mode={mode}
      data-open={open}
      style={{ '--gr-room-details-pane-width': `${paneWidth}px` } as CSSProperties}
    >
      <div ref={gameRoot} className='gr-room-details-game' tabIndex={-1} role='region' aria-label='游戏界面'>
        {game}
      </div>
      <div className='gr-room-details-scrim' aria-hidden='true' onClick={close} />
      <aside
        className='gr-room-details-pane'
        ref={paneRoot}
        aria-label='房间详情'
        aria-hidden={!open}
        inert={!open}
        onKeyDown={event => {
          if (event.key !== 'Escape') return
          event.preventDefault()
          close()
        }}
      >
        <header className='gr-room-details-pane-header'>
          <strong>房间详情</strong>
          <Button
            id='room-details-close'
            variant='ghost'
            className='gr-toolbar-icon'
            aria-label='收起房间详情'
            title='收起房间详情'
            onClick={close}
          >
            <Symbol name='close' size={16} />
          </Button>
        </header>
        <div className='gr-room-details-pane-scroll'>{children}</div>
      </aside>
    </section>
  )
}
