import { TokenAmount } from './token-amount.js'
import { AGENT_DISPATCH_ENABLED } from '../data/features.js'
import { useEffect, useRef, useState } from 'cordisx/react'
import { Button, Icon } from 'cordisx/ui'
import MoreH from 'reicon/icons/MoreH'
import type { Room, Source } from '../data/model.js'
import { economyLabel, encodeInvitation } from '../data/model.js'
import { Symbol } from './icons.js'
import holdem from '../assets/rooms/holdem.webp'
import gomoku from '../assets/rooms/gomoku.webp'
const agentIcon = 'agent'
const holdemIcon = 'holdem'
const gomokuIcon = 'gomoku'
const diceIcon = 'dice'
const seatIcon = 'seat'
import '../styles/room-card.css'

function MoreIcon() {
  const ref = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    const icon = MoreH({ size: 17, color: 'currentColor' })
    ref.current?.append(icon)
    return () => icon.remove()
  }, [])
  return <span ref={ref} aria-hidden='true' />
}
function AssetIcon({ src }: { src: string }) {
  return <span className='gr-card-symbol' data-icon={src} aria-hidden='true' />
}
function PlayerAvatar({ avatar, kind }: { avatar?: string; kind?: 'human' | 'agent' | 'bot' }) {
  const [failedAvatar, setFailedAvatar] = useState('')
  if (avatar && avatar !== failedAvatar) {
    return <img src={avatar} alt='' aria-hidden='true' onError={() => setFailedAvatar(avatar)} />
  }
  if (kind === 'bot') {
    return (
      <svg className='gr-card-seat-robot' viewBox='0 0 24 24' aria-hidden='true'>
        <path d='M12 3v3M9 3h6M5 10H3v6h2M19 10h2v6h-2' />
        <rect x='5' y='6' width='14' height='14' rx='3' />
        <path d='M9 11v2M15 11v2M9 16h6' />
      </svg>
    )
  }
  return (
    <svg viewBox='0 0 24 24' aria-hidden='true'>
      <circle cx='12' cy='9' r='4' />
      <path d='M4 24v-3a8 8 0 0 1 16 0v3' />
    </svg>
  )
}
export function RoomCard({ room, sourceName, sources, join, dispatch, busy, inspect }: {
  room: Room
  sourceName: string
  sources: Source[]
  join: () => void
  dispatch: () => void
  busy: boolean
  connected: boolean
  inspect: () => void
}) {
  const menu = useRef<HTMLDetailsElement>(null)
  const [copyStatus, setCopyStatus] = useState('')
  const available = room.compatible && room.state === 'waiting' && room.occupied < room.capacity
  const status = !room.compatible ? '版本不兼容' : room.owned ? '已加入' : room.state === 'finished'
    ? '已结束'
    : room.state === 'playing'
    ? '进行中'
    : available
    ? '可加入'
    : '已满'
  const game = room.game.id.includes('holdem') ? 'holdem' : room.game.id.includes('gomoku') ? 'gomoku' : 'fallback'
  const artwork = game === 'holdem' ? holdem : game === 'gomoku' ? gomoku : undefined
  const gameIcon = game === 'holdem' ? holdemIcon : game === 'gomoku' ? gomokuIcon : diceIcon
  const free = Math.max(0, room.capacity - room.occupied)
  const shownPlayers = Math.min(room.occupied, 3)
  const cost = `${economyLabel(room.mode)}${room.stake > 0 ? ` · ${room.stake}` : ''}`
  function showDetails() {
    if (menu.current) menu.current.open = false
    inspect()
  }
  async function copyInvitation() {
    try {
      await navigator.clipboard.writeText(encodeInvitation({ sourceId: room.sourceId, roomId: room.id }, sources))
      setCopyStatus('邀请信息已复制')
    } catch {
      setCopyStatus('未能复制，请在详情中手动复制邀请信息')
    }
  }
  return (
    <article
      className='gr-game-room-card'
      data-room-key={JSON.stringify([room.sourceId, room.id])}
      data-game={game}
      data-state={room.state}
      style={artwork ? { backgroundImage: `url("${artwork}")` } : undefined}
    >
      <div className='gr-card-header'>
        <span className='gr-card-game'>
          <AssetIcon src={gameIcon} />
          {room.game.name}
        </span>
        <span className='gr-card-status' data-status={status} role='img' aria-label={status} title={status} />
      </div>
      {game === 'fallback' && (
        <div className='gr-card-fallback'>
          <AssetIcon src={diceIcon} />
        </div>
      )}
      <div className='gr-card-content'>
        <button className='gr-card-title' onClick={showDetails} title={room.name}>{room.name}</button>
        <div className='gr-card-people' role='group' aria-label={`${room.capacity} 个席位，${room.occupied} 人已入座`}>
          {Array.from(
            { length: shownPlayers },
            (_, i) => (
              <span
                className='gr-card-seat'
                data-index={i}
                key={i}
                role='img'
                aria-label={room.participants?.[i]?.name ?? room.players[i] ?? `已入座玩家 ${i + 1}`}
                title={room.participants?.[i]?.name ?? room.players[i] ?? '已入座'}
              >
                <PlayerAvatar avatar={room.participants?.[i]?.avatar} kind={room.participants?.[i]?.kind} />
                {i === 2 && room.occupied > 3 && <span className='gr-card-seat-count'>{room.occupied}</span>}
              </span>
            ),
          )}
          {free > 0 && (
            <span
              className='gr-card-seat gr-card-seat-empty'
              role='img'
              aria-label={`剩余 ${free} 个空位`}
              title={`剩余 ${free} 个空位`}
            >
              <AssetIcon src={seatIcon} />
              <span className='gr-card-seat-count' aria-hidden='true'>{free}</span>
            </span>
          )}
        </div>
        <p className='gr-card-meta' title={`${cost} · ${sourceName}`}>
          {room.mode === 'token' ? <TokenAmount value={room.stake} /> : cost} · {sourceName}
        </p>
        <div className='gr-card-actions'>
          <Button className='gr-card-primary' disabled={busy} onClick={room.owned || available ? join : showDetails}>
            {room.owned ? '返回房间' : available ? room.mode === 'token' ? '确认加入' : '加入' : '查看房间'}
          </Button>
          {AGENT_DISPATCH_ENABLED && room.allowAgents && available && (
            <Button
              variant='ghost'
              className='gr-card-icon-button'
              disabled={busy}
              aria-label='派遣 Agent'
              title='派遣 Agent'
              onClick={dispatch}
            >
              <AssetIcon src={agentIcon} />
            </Button>
          )}
          <details
            ref={menu}
            className='gr-card-more'
            onKeyDown={event => {
              if (event.key === 'Escape' && menu.current) {
                menu.current.open = false
                menu.current.querySelector('summary')?.focus()
              }
            }}
          >
            <summary className='gr-card-icon-button' title='更多' aria-label='更多房间操作'>
              <MoreIcon />
            </summary>
            <div className='gr-card-menu'>
              <button onClick={showDetails}>
                <Icon className='gr-card-menu-icon' name='host:info' />
                <span className='gr-card-menu-label'>房间详情与规则</span>
              </button>
              <button onClick={() => void copyInvitation()}>
                <span className='gr-card-menu-icon'>
                  <Symbol name='copy' size={16} />
                </span>
                <span className='gr-card-menu-label'>复制邀请信息</span>
              </button>
              {copyStatus && <p role='status'>{copyStatus}</p>}
            </div>
          </details>
        </div>
      </div>
    </article>
  )
}
