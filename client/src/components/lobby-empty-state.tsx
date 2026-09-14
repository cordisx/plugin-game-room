import { useEffect, useState } from 'cordisx/react'
import { Button } from 'cordisx/ui'
import { Symbol } from './icons.js'
import '../styles/lobby-empty-state.css'

const suits = {
  clubs:
    'M191 80C187.7 80 185 82.7 185 86C185 87.2 185.4 88.4 186 89.4C185.4 89.1 184.7 89 184 89C180.7 89 178 91.7 178 95C178 98.3 180.7 101 184 101C186 101 187.8 100 188.9 98.5C188.7 102 187.6 104.7 185 107H197C194.4 104.7 193.3 102 193.1 98.5C194.2 100 196 101 198 101C201.3 101 204 98.3 204 95C204 91.7 201.3 89 198 89C197.3 89 196.6 89.1 196 89.4C196.6 88.4 197 87.2 197 86C197 82.7 194.3 80 191 80Z',
  spades: 'M13 1C10 5 1 12 1 17C1 23 9 25 11 20L8 27H18L15 20C17 25 25 23 25 17C25 12 16 5 13 1Z',
  hearts: 'M13 24C11 21 1 15 1 8C1 1 10 -1 13 6C16 -1 25 1 25 8C25 15 15 21 13 24Z',
  diamonds: 'M13 1L25 14L13 27L1 14Z',
}
function CardSuit({ suit }: { suit: keyof typeof suits }) {
  return <path d={suits[suit]} transform={suit === 'clubs' ? 'translate(-178 -80)' : undefined} />
}

const cardDeck = [
  { rank: 'Q', suit: 'clubs' },
  { rank: 'A', suit: 'spades' },
  { rank: 'K', suit: 'hearts' },
  { rank: 'J', suit: 'diamonds' },
  { rank: '10', suit: 'spades' },
] as const
type IllustrationCard = typeof cardDeck[number]
const cardSlots = [
  { x: 145, y: 60, angle: -12 },
  { x: 169, y: 57, angle: -6 },
  { x: 193, y: 58, angle: 0 },
  { x: 217, y: 62, angle: 6 },
  { x: 241, y: 68, angle: 12 },
]
function CardFace({ card }: { card: IllustrationCard }) {
  return (
    <>
      <rect className='gr-lobby-empty-paper' width='52' height='78' rx='6' />
      <g className='gr-lobby-empty-suit' data-warm={card.suit === 'hearts' || card.suit === 'diamonds'}>
        <text x='6' y='15' className='gr-lobby-empty-rank'>{card.rank}</text>
        <g transform='translate(6 20) scale(0.26)'>
          <CardSuit suit={card.suit} />
        </g>
        <g transform='translate(18 34) scale(0.62)'>
          <CardSuit suit={card.suit} />
        </g>
      </g>
    </>
  )
}
function AnimatedCards() {
  const [hand, setHand] = useState<IllustrationCard[]>([cardDeck[0]])
  const [departing, setDeparting] = useState<{ card: IllustrationCard; index: number } | null>(null)
  const [entering, setEntering] = useState<string | null>(null)
  const [reduced, setReduced] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const change = () => setReduced(media.matches)
    media.addEventListener('change', change)
    change()
    return () => media.removeEventListener('change', change)
  }, [])
  useEffect(() => {
    if (reduced) return
    let disposed = false
    let timer: ReturnType<typeof setTimeout>
    let cards: IllustrationCard[] = [cardDeck[0]]
    setHand(cards)
    setDeparting(null)
    setEntering(null)
    const schedule = (action: () => void, delay: number) => {
      timer = setTimeout(() => {
        if (!disposed) action()
      }, delay)
    }
    const play = () => {
      setEntering(null)
      if (cards.length === 1) {
        const missing = cardDeck.filter(card => !cards.includes(card))
        const refill = () => {
          const card = missing.splice(Math.floor(Math.random() * missing.length), 1)[0]
          cards = [...cards, card]
          setHand(cards)
          setEntering(card.rank)
          schedule(missing.length ? refill : play, missing.length ? 500 : 900)
        }
        schedule(refill, 450)
        return
      }
      const index = Math.floor(Math.random() * cards.length)
      setDeparting({ card: cards[index], index })
      cards = cards.filter((_, position) => position !== index)
      setHand(cards)
      schedule(() => {
        setDeparting(null)
        schedule(play, 450)
      }, 1600)
    }
    schedule(play, 250)
    return () => {
      disposed = true
      clearTimeout(timer)
    }
  }, [reduced])
  return (
    <>
      {(reduced ? cardDeck : hand).map((card, index) => {
        const slot = cardSlots[index]
        return (
          <g
            key={card.rank}
            className='gr-lobby-empty-card-position'
            data-hand-rank={card.rank}
            style={{ transform: `translate(${slot.x}px, ${slot.y}px)` }}
          >
            <g className={!reduced && entering === card.rank ? 'gr-lobby-empty-card-enter' : undefined}>
              <g className='gr-lobby-empty-card-angle' style={{ transform: `rotate(${slot.angle}deg)` }}>
                <CardFace card={card} />
              </g>
            </g>
          </g>
        )
      })}
      {!reduced && departing && (
        <g
          key={departing.card.rank}
          data-played-rank={departing.card.rank}
          transform={`translate(${cardSlots[departing.index].x} ${cardSlots[departing.index].y}) rotate(${
            cardSlots[departing.index].angle
          } 26 39)`}
        >
          <g className='gr-lobby-empty-card-played'>
            <CardFace card={departing.card} />
          </g>
        </g>
      )}
    </>
  )
}

export interface LobbyEmptyStateProps {
  kind: 'lobby' | 'game' | 'filter' | 'search' | 'loading'
  game?: { id: string; name: string }
  create: () => void
  reset?: () => void
}

export function LobbyEmptyState({ kind, game, create, reset }: LobbyEmptyStateProps) {
  const title = kind === 'loading'
    ? '正在加载房间…'
    : kind === 'search'
    ? '还没有找到这一局'
    : kind === 'filter'
    ? '换个条件，遇见下一局'
    : '下一局，从你开始'
  const description = kind === 'loading' ? '稍等片刻，好局即将开始。' : kind === 'search'
    ? '试试房间名或房间号，也可以自己开一局。'
    : kind === 'filter'
    ? '当前筛选下暂无房间。'
    : game
    ? `还没有${game.name}房间，邀朋友一起落座。`
    : '创建一个房间，和朋友一起玩。'
  const resetLabel = kind === 'search' ? '清空搜索' : kind === 'game' ? '查看全部玩法' : '清除筛选'
  return (
    <section className='gr-lobby-empty' aria-label='房间提示'>
      <div className='gr-lobby-empty-group'>
        <div className='gr-lobby-empty-scene' aria-hidden='true'>
          <svg viewBox='0 0 320 180' fill='none' className='gr-lobby-empty-drawing'>
            <g className='gr-lobby-empty-board'>
              {[62, 84, 106, 128, 150].map(x => <path key={x} d={`M${x} 18V146`} />)}
              {[36, 58, 80, 102, 124].map(y => <path key={y} d={`M44 ${y}H168`} />)}
            </g>
            <circle className='gr-lobby-empty-white' cx='106' cy='80' r='9' />
            <circle className='gr-lobby-empty-black' cx='128' cy='102' r='9' />
            {[
              { x: 84, y: 58, color: 'black', delay: '0.18s' },
              { x: 84, y: 124, color: 'white', delay: '1.69s' },
              { x: 62, y: 80, color: 'white', delay: '5.13s' },
              { x: 128, y: 36, color: 'black', delay: '6.07s' },
              { x: 62, y: 124, color: 'black', delay: '9.74s' },
              { x: 106, y: 58, color: 'white', delay: '11.73s' },
            ].map((move, index) => (
              <circle
                key={index}
                className={`gr-lobby-empty-${move.color} gr-lobby-empty-move`}
                data-move={index}
                cx={move.x}
                cy={move.y}
                r='9'
                style={{ animationDelay: move.delay }}
              />
            ))}
            <AnimatedCards />
            <path
              className='gr-lobby-empty-leaf'
              d='M13 86c13 0 21 8 25 20-13-1-22-8-25-20Zm10 28c6-5 12-5 17-2-5 6-11 7-17 2Z'
            />
            <circle className='gr-lobby-empty-accent' cx='308' cy='156' r='6' />
          </svg>
        </div>
        <div className='gr-lobby-empty-copy'>
          <h2>{title}</h2>
          <p>{description}</p>
          {kind !== 'loading' && (
            <div className='gr-lobby-empty-actions'>
              <Button variant='ghost' className='gr-lobby-empty-create' onClick={create}>
                <Symbol name='plus' size={16} />
                {game ? `开一局${game.name}` : '创建房间'}
              </Button>
              {reset && kind !== 'lobby' && (
                <Button variant='ghost' className='gr-lobby-empty-reset' onClick={reset}>{resetLabel}</Button>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
