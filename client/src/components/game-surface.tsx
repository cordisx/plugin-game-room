import type { ReactElement } from 'cordisx/react'
import { useEffect, useRef, useState } from 'cordisx/react'
import type {
  RestrictedContentSceneV1,
  RestrictedContentSeatV1,
  RestrictedContentV1,
} from '@cordisx/protocol/restricted-content/v1'
import { Button } from 'cordisx/ui'
import { RequestFailure } from '../data/http.js'
import type { Seat } from '../data/model.js'
import type { GameRoomPort } from '../data/port.js'
export function GameSurface(
  { seat, port, service, changed }: {
    seat: Seat
    port: GameRoomPort
    service?: RestrictedContentV1
    changed: (seat: Seat) => void
  },
): ReactElement {
  const element = useRef<HTMLDivElement>(null)
  const current = useRef(seat)
  current.current = seat
  const changedRef = useRef(changed)
  changedRef.current = changed
  const mounted = useRef<RestrictedContentSeatV1 | undefined>(undefined)
  const published = useRef(-1)
  const lifecycle = useRef<AbortController | undefined>(undefined)
  const [status, setStatus] = useState('正在加载对局界面')
  const [recovery, setRecovery] = useState<{ seat: Seat; action: unknown } | null>(null)
  const [recovering, setRecovering] = useState(false)
  const [recoveryEpoch, setRecoveryEpoch] = useState(0)
  const [mountEpoch, setMountEpoch] = useState(0)
  const identity = JSON.stringify([
    seat.room.sourceId,
    seat.room.id,
    seat.matchId,
    seat.seatId,
    seat.room.game.packageHash,
  ])
  useEffect(() => {
    const controller = new AbortController()
    lifecycle.current = controller
    let active = true
    let pending = false
    published.current = -1
    if (!service || !element.current) {
      setStatus('当前 Host 尚不支持隔离游戏场景')
      return
    }
    void service.mount({
      element: element.current,
      onUnavailable: code => {
        if (active) setStatus(`对局界面不可用：${code}`)
      },
      onAction: async action => {
        const latest = current.current
        if (!active || pending || latest.status !== 'playing' || action.sequence !== latest.version || !port.act) {
          return { status: 'rejected' as const }
        }
        pending = true
        try {
          const next = await port.act(latest, action.payload, controller.signal)
          if (!active) return { status: 'uncertain' as const }
          if (mounted.current && next.version !== undefined && next.version > published.current) {
            const publication = mounted.current.publish({
              sequence: next.version,
              payload: (next.scene ?? null) as RestrictedContentSceneV1 | null,
            })
            if (publication.status === 'accepted') published.current = next.version
          }
          changedRef.current(next)
          return { status: 'accepted' as const }
        } catch (error) {
          if (active) {
            setStatus(error instanceof Error ? error.message : '动作结果未确认，请恢复连接')
            if (!(error instanceof RequestFailure) || error.outcome !== 'rejected') {
              setRecovery({ seat: latest, action: action.payload })
            }
          }
          return {
            status: error instanceof RequestFailure && error.outcome === 'rejected'
              ? 'rejected' as const
              : 'uncertain' as const,
          }
        } finally {
          pending = false
        }
      },
    }).then(result => {
      if (!active) {
        if (result.status === 'accepted') result.value.dispose()
        return
      }
      if (result.status !== 'accepted') {
        setStatus(`对局界面不可用：${result.code}`)
        return
      }
      mounted.current = result.value
      setStatus('')
      setMountEpoch(epoch => epoch + 1)
    }).catch(() => {
      if (active) setStatus('Host 场景挂载失败')
    })
    return () => {
      active = false
      controller.abort()
      mounted.current?.dispose()
      mounted.current = undefined
    }
  }, [service, port, identity, recoveryEpoch])
  useEffect(() => {
    if (!mounted.current || seat.version === undefined || seat.version <= published.current) return
    const result = mounted.current.publish({
      sequence: seat.version,
      payload: (seat.scene ?? null) as RestrictedContentSceneV1 | null,
    })
    if (result.status === 'unavailable') {
      setStatus(`场景不可用：${result.code}`)
      return
    }
    published.current = seat.version
  }, [seat.version, seat.scene, mountEpoch])
  return (
    <div className='gr-game-surface'>
      <div ref={element} className='gr-scene-root' aria-label='当前席位游戏场景' />
      {recovery && (
        <Button
          disabled={recovering}
          onClick={() => {
            if (!port.act || recovering) return
            setRecovering(true)
            const original = recovery
            const signal = lifecycle.current?.signal
            if (!signal || signal.aborted) {
              setRecovering(false)
              return
            }
            void port.act(original.seat, original.action, AbortSignal.any([signal, AbortSignal.timeout(15000)])).then(
              next => {
                if (
                  signal.aborted || current.current.matchId !== original.seat.matchId
                  || current.current.seatId !== original.seat.seatId
                ) return
                if ((next.version ?? 0) >= (current.current.version ?? 0)) changedRef.current(next)
                setRecovery(null)
                setStatus('')
                setRecoveryEpoch(value => value + 1)
              },
            ).catch(error => {
              if (!signal.aborted) setStatus(error instanceof Error ? error.message : '结果仍未确认')
            }).finally(() => {
              if (!signal.aborted) setRecovering(false)
            })
          }}
        >
          重新确认上次动作（同一请求）
        </Button>
      )}
      {seat.sceneError && (
        <div className='gr-error' role='alert'>
          本局因游戏界面错误中止：{seat.sceneError}。结算状态：{seat.settlementState}。
        </div>
      )}
      {status && <div className='gr-source-notice' role='status'>{status}</div>}
    </div>
  )
}
