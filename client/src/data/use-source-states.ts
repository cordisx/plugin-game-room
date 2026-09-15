import { cachedSourceStates, cacheSourceStates } from './source-state-cache.js'
import { useEffect, useRef, useState } from 'cordisx/react'
import { SourceAggregator } from './aggregate.js'
import type { SourceState } from './model.js'
import type { GameRoomPort } from './port.js'

/** One effect owns the source and serializes background and explicit refreshes. */
export function useSourceStates(
  port: GameRoomPort,
  revision: number,
  pollMs = 2000,
  ownerRevision: number | string = 0,
): SourceState[] {
  const [state, setState] = useState<{ owner: GameRoomPort; ownerRevision: number | string; states: SourceState[] }>({
    owner: port,
    ownerRevision,
    states: cachedSourceStates(port, ownerRevision),
  })
  const request = useRef<(() => void) | undefined>(undefined)
  const previousRevision = useRef(revision)
  useEffect(() => {
    const aggregate = new SourceAggregator(
      port,
      states => {
        cacheSourceStates(port, ownerRevision, states)
        setState({ owner: port, ownerRevision, states })
      },
      15000,
      30000,
      cachedSourceStates(port, ownerRevision),
    )
    let closed = false
    let busy = false
    let dirty = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const refresh = async () => {
      if (closed) return
      if (busy) {
        dirty = true
        return
      }
      clearTimeout(timer)
      busy = true
      await aggregate.refresh()
      busy = false
      if (closed) return
      if (dirty) {
        dirty = false
        void refresh()
      } else timer = setTimeout(refresh, pollMs)
    }
    const trigger = () => {
      void refresh()
    }
    request.current = trigger
    trigger()
    return () => {
      closed = true
      if (request.current === trigger) request.current = undefined
      clearTimeout(timer)
      aggregate.dispose()
    }
  }, [port, pollMs, ownerRevision])
  useEffect(() => {
    const changed = previousRevision.current !== revision
    previousRevision.current = revision
    if (changed) request.current?.()
  }, [revision])
  return state.owner === port && state.ownerRevision === ownerRevision ? state.states : []
}
