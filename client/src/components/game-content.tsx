import { useEffect, useRef, useState } from 'cordisx/react'
import type {
  GameUiBundleV1,
  GameUiRequestV1,
  GameUiSeatV1,
  GameUiSnapshotV1,
  IsolatedGameUiV1,
} from '@cordisx/protocol/isolated-game-ui/v1'
import type { RestrictedContentV1 } from '@cordisx/protocol/restricted-content/v1'
import { Button } from 'cordisx/ui'
import { GameSurface as SceneSurface } from './game-surface.js'
import type { GameRoomPort } from '../data/port.js'
import { consentFor, type Seat } from '../data/model.js'
import { RequestFailure } from '../data/http.js'
import { type KnownHtmlUi, loadKnownHtmlUi } from '../data/known-html-ui.js'
import { canResumeFinishedGame, leaveGameView, performGameAction } from '../data/game-action.js'
import gomokuPresentation from '../data/gomoku-presentation.json' with { type: 'json' }
import '../styles/game-status.css'

type RoomAction = 'ready' | 'cancel-ready' | 'start' | 'funding' | 'next-round'
type RoomRequest = Omit<GameUiRequestV1, 'kind' | 'payload'> & {
  kind: GameUiRequestV1['kind'] | 'room-action'
  payload: unknown
}
type RoomSnapshot = GameUiSnapshotV1 & { roomActions: readonly RoomAction[] }

export function GameSurface(
  props: {
    seat: Seat
    port: GameRoomPort
    service?: RestrictedContentV1
    htmlService?: IsolatedGameUiV1
    exitRequest?: number
    syncRevision?: number
    connectionError?: string
    recoverConnection?: () => void
    funding?: (signal: AbortSignal) => Promise<void>
    changed: (seat: Seat) => void
    exited: () => void
  },
) {
  const [loaded, setLoaded] = useState<KnownHtmlUi | null>()
  const [error, setError] = useState('')
  const [exitApproval, setExitApproval] = useState(false)
  const [working, setWorking] = useState(false)
  const [exitError, setExitError] = useState('')
  useEffect(() => {
    if (props.exitRequest) setExitApproval(true)
  }, [props.exitRequest])
  useEffect(() => {
    const controller = new AbortController()
    setLoaded(undefined)
    setError('')
    if (!props.port.gameUi) {
      setLoaded({ bundle: null, waitingUi: false })
      return
    }
    void loadKnownHtmlUi(props.port, props.seat.room, controller.signal, props.seat.status).then(value => {
      if (!controller.signal.aborted) setLoaded(value)
    }).catch(e => {
      if (!controller.signal.aborted) setError(e.message)
    })
    return () => controller.abort()
  }, [
    props.port,
    props.seat.room.sourceId,
    props.seat.room.game.packageHash,
    props.seat.status,
    props.syncRevision,
    gomokuPresentation.digest,
  ])

  let content
  if (props.seat.closed) {
    content = (
      <section className='gr-game-recovery' role='status'>
        <p>房主已关闭房间</p>
        <Button onClick={props.exited}>返回大厅</Button>
      </section>
    )
  } else if (
    ['waiting', 'funding'].includes(props.seat.status ?? '') && !props.seat.room.game.waitingUi
    && loaded?.bundle === null
  ) {
    content = (
      <section aria-label='等待开局'>
        <p>{props.seat.room.game.name} · 等待开局</p>
        {props.seat.participants?.map(s => <p key={s.id}>{s.name} · {s.ready ? '已准备' : '未准备'}</p>)}
      </section>
    )
  } else if (error) content = <p role='status'>{error}</p>
  else if (loaded === undefined) content = <p role='status'>正在加载游戏界面…</p>
  else if (loaded === null || loaded.bundle === null) content = <SceneSurface {...props} />
  else {
    content = (
      <HtmlGameSurface
        {...props}
        bundle={loaded.bundle}
        waitingUi={loaded.waitingUi}
        requestExit={() => setExitApproval(true)}
      />
    )
  }

  return (
    <div className='gr-game-surface'>
      {content}
      {props.connectionError && (
        <div className='gr-game-recovery' role='status'>
          <p>连接自动恢复失败：{props.connectionError}</p>
          <Button onClick={props.recoverConnection}>重试连接</Button>
        </div>
      )}
      {exitApproval && (
        <div className='gr-game-recovery' role='dialog' aria-label='确认退出'>
          <p>
            {props.seat.status === 'playing' ? '返回大厅？对局会继续计时，可随时返回。' : '确认离开房间，返回大厅？'}
          </p>
          {exitError && <p role='status'>{exitError}</p>}
          <Button onClick={() => setExitApproval(false)}>取消</Button>
          <Button
            disabled={working}
            onClick={() => {
              setWorking(true)
              setExitError('')
              void leaveGameView(props.port, props.seat, new AbortController().signal).then(props.exited)
                .catch(() => setExitError('暂时未能退出，请重试。')).finally(() => setWorking(false))
            }}
          >
            确认
          </Button>
        </div>
      )}
    </div>
  )
}

function roomActions(seat: Seat): RoomAction[] {
  const actions: RoomAction[] = []
  if (seat.status === 'waiting') {
    actions.push(seat.ready ? 'cancel-ready' : 'ready')
    if (seat.canStart) actions.push('start')
  }
  if (seat.status === 'funding' && seat.walletSpend?.phase === 'funding') actions.push('funding')
  if (seat.canNextMatch) actions.push('next-round')
  return actions
}

function snapshot(seat: Seat, waitingUi: boolean): RoomSnapshot {
  const color = getComputedStyle(document.documentElement).colorScheme
  return {
    matchId: seat.matchId!,
    sequence: seat.version!,
    observation: ['waiting', 'funding'].includes(seat.status ?? '') && !waitingUi
      ? null
      : seat.observation && typeof seat.observation === 'object' && !Array.isArray(seat.observation)
      ? {
        ...seat.observation,
        turnDeadline: seat.turnDeadline ?? null,
        canResumeUndo: canResumeFinishedGame(seat),
      } as GameUiSnapshotV1['observation']
      : seat.observation as GameUiSnapshotV1['observation'],
    status: seat.status ?? 'waiting',
    canAct: (seat.status === 'playing' && !!seat.legalActions?.length) || canResumeFinishedGame(seat),
    readOnly: false,
    theme: color.includes('dark') ? 'dark' : 'light',
    roomActions: roomActions(seat),
    participants: seat.gameParticipants,
  }
}

function HtmlGameSurface(
  props: {
    seat: Seat
    port: GameRoomPort
    htmlService?: IsolatedGameUiV1
    bundle: GameUiBundleV1
    waitingUi: boolean
    syncRevision?: number
    connectionError?: string
    recoverConnection?: () => void
    funding?: (signal: AbortSignal) => Promise<void>
    changed: (seat: Seat) => void
    requestExit: () => void
  },
) {
  const root = useRef<HTMLDivElement>(null)
  const mounted = useRef<GameUiSeatV1 | undefined>(undefined)
  const latest = useRef(props)
  latest.current = props
  const [status, setStatus] = useState('')
  useEffect(() => {
    const abort = new AbortController()
    let active = true
    if (!props.htmlService || !root.current) {
      setStatus('当前 Host 尚不支持 HTML 游戏界面')
      return
    }
    setStatus('')
    void props.htmlService.mount({
      element: root.current,
      bundle: props.bundle,
      title: '游戏界面',
      onUnavailable: code => {
        if (active) setStatus(`界面已停止：${code}。可以重新加载或返回大厅。`)
      },
      onRequest: async rawRequest => {
        const request = rawRequest as RoomRequest
        const p = latest.current
        if (!active || request.matchId !== p.seat.matchId || request.sequence !== p.seat.version) {
          return { status: 'rejected', code: 'stale-state' }
        }
        if (request.kind === 'exit') {
          p.requestExit()
          return { status: 'rejected', code: 'approval-required' }
        }
        try {
          let next: Seat | undefined
          if (request.kind === 'action') {
            next = await performGameAction(p.port, p.seat, request.payload, abort.signal)
          } else if (request.kind === 'next-round') {
            if (!p.seat.canNextMatch || !p.port.nextMatch) return { status: 'rejected', code: 'not-actionable' }
            next = await p.port.nextMatch(p.seat, abort.signal)
          } else if (request.kind === 'room-action') {
            const operation = (request.payload as { operation?: unknown } | null)?.operation
            if (!roomActions(p.seat).includes(operation as RoomAction)) {
              return { status: 'rejected', code: 'not-actionable' }
            }
            if (operation === 'ready' || operation === 'cancel-ready') {
              next = await p.port.ready(
                p.seat,
                operation === 'ready',
                operation === 'ready' ? consentFor(p.seat.room) : undefined,
                abort.signal,
              )
            } else if (operation === 'start') {
              if (!p.port.start) return { status: 'rejected', code: 'unavailable' }
              next = await p.port.start(p.seat, abort.signal)
            } else if (operation === 'funding') {
              if (!p.funding) return { status: 'rejected', code: 'unavailable' }
              await p.funding(abort.signal)
            }
          } else return { status: 'rejected', code: 'unsupported-request' }
          if (!active) return { status: 'uncertain' }
          if (next) {
            p.changed(next)
            mounted.current?.publish(snapshot(next, p.waitingUi))
          }
          return { status: 'accepted' }
        } catch (e) {
          if (active) {
            if (!(e instanceof RequestFailure) || e.outcome === 'uncertain') {
              setStatus('正在自动恢复连接…')
              p.recoverConnection?.()
            } else setStatus('操作未执行，请按最新局面重试。')
          }
          return { status: e instanceof RequestFailure && e.outcome === 'rejected' ? 'rejected' : 'uncertain' }
        }
      },
    }).then(result => {
      if (result.status !== 'accepted') {
        if (active) setStatus(`无法加载游戏：${result.code}`)
        return
      }
      if (!active) {
        result.value.dispose()
        return
      }
      mounted.current = result.value
      result.value.publish(snapshot(latest.current.seat, latest.current.waitingUi))
    }).catch(() => {
      if (active) setStatus('游戏界面加载失败')
    })
    return () => {
      active = false
      abort.abort()
      mounted.current?.dispose()
      mounted.current = undefined
    }
  }, [
    props.htmlService,
    props.bundle,
    props.seat.matchId,
    props.seat.seatId,
    props.seat.room.sourceId,
    props.syncRevision,
  ])
  useEffect(() => {
    mounted.current?.publish(snapshot(props.seat, props.waitingUi))
  }, [props.seat.version, props.seat.observation, props.waitingUi])
  return (
    <>
      <div className='gr-html-scene-root' ref={root} />
      {status && (
        <div role='status'>
          <p>{status}</p>
          {status !== '正在自动恢复连接…' && status !== '操作未执行，请按最新局面重试。' && (
            <Button onClick={props.recoverConnection}>重试连接</Button>
          )}
        </div>
      )}
    </>
  )
}
