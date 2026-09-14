import { useEffect, useRef, useState } from 'cordisx/react'
import { Button } from 'cordisx/ui'
import { Symbol } from './icons.js'
import type { GameUiSeatV1, GameUiSnapshotV1, IsolatedGameUiV1 } from '@cordisx/protocol/isolated-game-ui/v1'
import type { RestrictedContentV1 } from '@cordisx/protocol/restricted-content/v1'
import type { GameRoomPort } from '../data/port.js'
import type { Room } from '../data/model.js'
import { loadKnownHtmlUi } from '../data/known-html-ui.js'
import { Spectator as SceneSpectator } from './spectator.js'
export function Spectator(
  props: {
    room: Room
    port: GameRoomPort
    service?: RestrictedContentV1
    htmlService?: IsolatedGameUiV1
    close: () => void
  },
) {
  const root = useRef<HTMLDivElement>(null)
  const [legacy, setLegacy] = useState(false)
  const [status, setStatus] = useState('正在连接观战')
  useEffect(() => {
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    let mounted: GameUiSeatV1 | undefined
    if (!props.port.gameUi) {
      setLegacy(true)
      return
    }
    void (async () => {
      const loaded = await loadKnownHtmlUi(props.port, props.room, controller.signal, props.room.state)
      if (controller.signal.aborted) return
      if (!loaded.bundle) {
        setLegacy(true)
        return
      }
      if (!props.htmlService || !root.current || !props.port.spectate) throw Error('当前 Host 不支持 HTML 观战界面')
      const result = await props.htmlService.mount({
        element: root.current,
        bundle: loaded.bundle,
        title: '公共观战场景',
        onRequest: async request => {
          if (request.kind === 'exit' && !controller.signal.aborted) {
            props.close()
            return { status: 'accepted' }
          }
          return { status: 'rejected', code: 'read-only' }
        },
        onUnavailable: code => {
          if (!controller.signal.aborted) setStatus(`观战界面停止：${code}`)
        },
      })
      if (result.status !== 'accepted') throw Error(result.code)
      mounted = result.value
      if (controller.signal.aborted) {
        mounted.dispose()
        return
      }
      let matchId = ''
      const refresh = async () => {
        try {
          const view = await props.port.spectate!(props.room, controller.signal)
          if (controller.signal.aborted) return
          if (matchId && matchId !== view.matchId) {
            mounted?.dispose()
            setStatus('新一局已开始，请重新打开观战')
            return
          }
          matchId = view.matchId
          mounted!.publish({
            matchId,
            sequence: view.version,
            participants: view.participants,
            observation: (view.observation ?? null) as GameUiSnapshotV1['observation'],
            status: view.status,
            canAct: false,
            readOnly: true,
            theme: getComputedStyle(root.current!).colorScheme.includes('dark') ? 'dark' : 'light',
          })
          setStatus(view.status === 'finished' ? '对局已结束 · 只读观战' : '观战中 · 仅公共信息')
        } catch (e) {
          if (!controller.signal.aborted) setStatus(e instanceof Error ? e.message : '观战连接中断')
        }
        if (!controller.signal.aborted) timer = setTimeout(() => void refresh(), 2000)
      }
      await refresh()
    })().catch(e => {
      if (!controller.signal.aborted) setStatus(e.message)
    })
    return () => {
      controller.abort()
      clearTimeout(timer)
      mounted?.dispose()
    }
  }, [props.room.sourceId, props.room.id, props.port, props.htmlService])
  if (legacy) return <SceneSpectator {...props} />
  return (
    <aside className='gr-spectator' aria-label='观战'>
      <header className='gr-spectator-header'>
        <div className='gr-spectator-heading'>
          <strong>观战</strong>
          <Button
            variant='ghost'
            className='gr-toolbar-icon'
            aria-label='退出观战'
            title='退出观战'
            onClick={props.close}
          >
            <Symbol name='close' size={16} />
          </Button>
        </div>
        <p role='status'>{status}</p>
      </header>
      <div className='gr-html-scene-root' ref={root} />
      <footer className='gr-spectator-footer'>
        <p>不占席位 · 不投入资产</p>
      </footer>
    </aside>
  )
}
