import { roomOwnerSvg } from '../assets/room-owner.js'
import { Button } from 'cordisx/ui'
import type { BotChange, Room } from '../data/model.js'
import { Symbol } from './icons.js'
import '../styles/room-players.css'
export function RoomPlayers({ room, busy = false, bots }: {
  room: Room
  busy?: boolean
  bots?: (change: BotChange) => void
}) {
  const manage = room.state === 'waiting' && room.canManageBots && !!bots
  return (
    <ul className='gr-room-players' aria-label='玩家席位'>
      {Array.from({ length: room.capacity }, (_, seatIndex) => {
        const player = room.participants?.find(player => player.seatIndex === seatIndex)
        const name = player?.name.startsWith('guest_') ? '匿名玩家' : player?.name
        return (
          <li key={seatIndex} data-seat-index={seatIndex}>
            <span className='gr-room-player-avatar' aria-hidden='true'>
              {player?.kind === 'bot'
                ? '机'
                : player?.name.startsWith('guest_')
                ? <Symbol name='personal' size={18} />
                : name?.slice(0, 1).toUpperCase() || <Symbol name='personal' size={18} />}
              {player?.avatar && (
                <img
                  src={player.avatar}
                  alt=''
                  referrerPolicy='no-referrer'
                  onError={e => e.currentTarget.hidden = true}
                />
              )}
            </span>
            <div className='gr-room-player-copy'>
              <strong>
                <span title={name ?? '空席'}>{name ?? '空席'}</span>
                {player?.isOwner && (
                  <span
                    className='gr-room-player-owner'
                    title='房主'
                    aria-label='房主'
                    dangerouslySetInnerHTML={{ __html: roomOwnerSvg }}
                  />
                )}
              </strong>
              <span>{seatIndex + 1} 号位{player ? ` · ${player.ready ? '已准备' : '未准备'}` : ' · 等待加入'}</span>
            </div>
            <div className='gr-room-player-actions'>
              {manage && !player && (
                <Button
                  variant='ghost'
                  className='gr-room-player-action'
                  disabled={busy || room.mode === 'token' || !room.game.rulesBot}
                  title={`在 ${seatIndex + 1} 号位添加规则电脑`}
                  aria-label={`在 ${seatIndex + 1} 号位添加规则电脑`}
                  onClick={() => bots!({ add: true, seatIndex })}
                >
                  <svg
                    width='18'
                    height='18'
                    viewBox='0 0 24 24'
                    fill='none'
                    stroke='currentColor'
                    strokeWidth='1.5'
                    strokeLinecap='round'
                    strokeLinejoin='round'
                    aria-hidden='true'
                  >
                    <path d='M9 5V2M7 5h8a2 2 0 0 1 2 2v7H5V7a2 2 0 0 1 2-2ZM2 9v3M20 8v3M8 9h.01M14 9h.01M8 18h6M7 14v4M15 14v2M19 15v6M16 18h6' />
                  </svg>
                </Button>
              )}
              {manage && player?.kind === 'bot' && (
                <Button
                  variant='ghost'
                  className='gr-room-player-action'
                  disabled={busy}
                  title={`移除 ${seatIndex + 1} 号位规则电脑`}
                  aria-label={`移除 ${seatIndex + 1} 号位规则电脑`}
                  onClick={() => bots!({ removeSeatId: player.id })}
                >
                  <Symbol name='minus' size={16} />
                </Button>
              )}
              {!player && (
                <Button
                  variant='ghost'
                  className='gr-room-player-action'
                  disabled
                  title='邀请好友（暂未开放）'
                  aria-label='邀请好友（暂未开放）'
                >
                  <svg
                    width='18'
                    height='18'
                    viewBox='0 0 24 24'
                    fill='none'
                    stroke='currentColor'
                    strokeWidth='1.5'
                    strokeLinecap='round'
                    strokeLinejoin='round'
                    aria-hidden='true'
                  >
                    <circle cx='9' cy='7' r='3' />
                    <path d='M3 20v-2a6 6 0 0 1 12 0v2M19 8v6M16 11h6' />
                  </svg>
                </Button>
              )}
            </div>
          </li>
        )
      })}
    </ul>
  )
}
