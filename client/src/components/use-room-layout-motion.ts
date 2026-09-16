import { useEffect, useLayoutEffect, useRef } from 'cordisx/react'
/** Snapshot plugin-owned cards before the discrete layout change, then animate to the new grid. */
export function useRoomLayoutMotion(layoutKey: string | null) {
  const root = useRef<HTMLDivElement>(null)
  const before = useRef(new Map<string, DOMRect>())
  const scroll = useRef<number | null>(null)
  const animations = useRef<Animation[]>([])
  const cancel = () => {
    for (const animation of animations.current) animation.cancel()
    animations.current = []
  }
  function capture() {
    before.current.clear()
    root.current?.querySelectorAll<HTMLElement>('[data-room-key]').forEach(card => {
      before.current.set(card.dataset.roomKey!, card.getBoundingClientRect())
    })
    scroll.current = root.current?.querySelector('.gr-room-results')?.scrollTop ?? null
    cancel()
  }
  useLayoutEffect(() => {
    const list = root.current?.querySelector('.gr-room-results')
    if (list && scroll.current !== null) list.scrollTop = scroll.current
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
      before.current.clear()
      return
    }
    root.current?.querySelectorAll<HTMLElement>('[data-room-key]').forEach(card => {
      const previous = before.current.get(card.dataset.roomKey!)
      if (!previous) return
      const next = card.getBoundingClientRect()
      if (!next.width || !next.height) return
      const dx = previous.x - next.x, dy = previous.y - next.y
      const sx = previous.width / next.width, sy = previous.height / next.height
      if (Math.abs(dx) < .5 && Math.abs(dy) < .5 && Math.abs(sx - 1) < .002) return
      animations.current.push(card.animate([
        { transformOrigin: 'top left', transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})` },
        { transformOrigin: 'top left', transform: 'none' },
      ], { duration: 220, easing: 'cubic-bezier(.2,.8,.2,1)' }))
    })
    before.current.clear()
    scroll.current = null
  }, [layoutKey])
  useEffect(() => cancel, [])
  return { root, capture }
}
