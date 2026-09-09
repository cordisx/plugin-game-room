import { useEffect, useRef } from 'cordisx/react'
import Settings from 'reicon/icons/Settings'
import Gamepad from 'reicon/icons/Gamepad'
import Grid from 'reicon/icons/Grid'
import Cards from 'reicon/icons/Cards'
import Cpu from 'reicon/icons/Cpu'
import Rocket from 'reicon/icons/Rocket'
import Server from 'reicon/icons/Server'
import User from 'reicon/icons/User'
import Plus from 'reicon/icons/Plus'
import ArrowLeft from 'reicon/icons/ArrowLeft'
const icons = {
  settings: Settings,
  game: Gamepad,
  grid: Grid,
  cards: Cards,
  agent: Cpu,
  dispatch: Rocket,
  source: Server,
  personal: User,
  plus: Plus,
  back: ArrowLeft,
}
export type SymbolName = keyof typeof icons
/** Fixed, bundled Reicon assets; no server-provided markup is rendered. */
export function Symbol({ name, size = 18 }: { name: SymbolName; size?: number }) {
  const ref = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    const icon = icons[name]({ size, color: 'currentColor' })
    ref.current?.append(icon)
    return () => icon.remove()
  }, [name, size])
  return <span className='gr-symbol' ref={ref} aria-hidden='true' />
}
export function GameIcon({ id, size = 24 }: { id: string; size?: number }) {
  return <Symbol name={id.includes('gomoku') ? 'grid' : id.includes('holdem') ? 'cards' : 'game'} size={size} />
}
