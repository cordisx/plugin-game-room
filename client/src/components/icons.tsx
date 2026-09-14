import Eye from 'reicon/icons/Eye'
import Coins from 'reicon/icons/Coins'
import Trophy from 'reicon/icons/Trophy'
import FileText from 'reicon/icons/FileText'
import Copy from 'reicon/icons/Copy'
import ArrowUpRight from 'reicon/icons/ArrowUpRight'
import X from 'reicon/icons/X'
import ChevronDown from 'reicon/icons/ChevronDown'
import Check from 'reicon/icons/Check'
import Clock from 'reicon/icons/Clock'
import Refresh from 'reicon/icons/Refresh'
import Filter from 'reicon/icons/Filter'
import Link from 'reicon/icons/Link'
import Search from 'reicon/icons/Search'
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
import ArrowDoorOut from 'reicon/icons/ArrowDoorOut'
import Minus from 'reicon/icons/Minus'
const icons = {
  watch: Eye,
  coins: Coins,
  score: Trophy,
  document: FileText,
  copy: Copy,
  external: ArrowUpRight,
  search: Search,
  link: Link,
  filter: Filter,
  reset: Refresh,
  clock: Clock,
  check: Check,
  down: ChevronDown,
  close: X,

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
  leave: ArrowDoorOut,
  minus: Minus,
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
  return (
    <span className='gr-symbol' ref={ref} style={{ width: size, height: size, flexBasis: size }} aria-hidden='true' />
  )
}
export function GameIcon({ id, size = 24 }: { id: string; size?: number }) {
  return <Symbol name={id.includes('gomoku') ? 'grid' : id.includes('holdem') ? 'cards' : 'game'} size={size} />
}
