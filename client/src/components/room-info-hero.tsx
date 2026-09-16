import type { ReactNode } from 'cordisx/react'
import { GameIcon } from './icons.js'
import holdem from '../assets/rooms/holdem-detail-felt.png'
import gomoku from '../assets/rooms/gomoku-detail-walnut.png'
import '../styles/room-info-hero.css'
import '../styles/room-info-surface.css'
export function RoomInfoHero({ gameId, gameName, title, actions, tabs, preview = false }: {
  gameId: string
  gameName: string
  title: string
  actions?: ReactNode
  tabs?: ReactNode
  preview?: boolean
}) {
  const artwork = gameId.includes('holdem') ? holdem : gameId.includes('gomoku') ? gomoku : undefined
  return (
    <header
      className='gr-room-info-hero'
      data-preview={preview}
      data-artwork={!!artwork}
      data-game-theme={gameId.includes('gomoku') ? 'gomoku' : gameId.includes('holdem') ? 'holdem' : undefined}
    >
      {artwork && <img className='gr-room-info-hero-image' src={artwork} alt='' />}
      <div className='gr-room-info-hero-top'>
        <span className='gr-room-info-hero-game'>
          <GameIcon id={gameId} size={16} />
          {gameName}
        </span>
        <div className='gr-room-info-hero-actions'>{actions}{preview && <span>预览</span>}</div>
      </div>
      <div className='gr-room-info-hero-copy'>
        <h2>{title}</h2>
      </div>
      {tabs}
    </header>
  )
}
