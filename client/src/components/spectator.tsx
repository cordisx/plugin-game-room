import { useEffect, useRef, useState } from 'cordisx/react'
import { Button } from 'cordisx/ui'
import type { RestrictedContentSceneV1, RestrictedContentV1 } from '@cordisx/protocol/restricted-content/v1'
import type { GameRoomPort } from '../data/port.js'
import type { Room } from '../data/model.js'
import { Symbol } from './icons.js'
import '../styles/game-status.css'
export function Spectator({ room, port, service, close }: {
  room: Room
  port: GameRoomPort
  service?: RestrictedContentV1
  close: () => void
}) {
  const element = useRef<HTMLDivElement>(null)
  const [status, setStatus] = useState('正在连接观战')
  useEffect(() => {
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    let dispose: (() => void) | undefined
    if (!element.current || !service || !port.spectate) {
      setStatus('当前环境不支持观战场景')
      return
    }
    void (async () => {
      const mounted = await service.mount({
        element: element.current!,
        onAction: async () => ({ status: 'rejected' as const }),
        onUnavailable: code => {
          if (!controller.signal.aborted) setStatus(`观战不可用：${code}`)
        },
      })
      if (mounted.status !== 'accepted') {
        setStatus('无法加载观战场景')
        return
      }
      dispose = () => mounted.value.dispose()
      if (controller.signal.aborted) {
        dispose()
        return
      }
      let sequence = 0
      let last = ''
      const refresh = async () => {
        try {
          const view = await port.spectate!(room, controller.signal)
          if (controller.signal.aborted) return
          const key = JSON.stringify([view.matchId, view.version])
          if (key !== last) {
            mounted.value.publish({ sequence: ++sequence, payload: view.scene as RestrictedContentSceneV1 | null })
            last = key
          }
          setStatus(
            view.status === 'playing'
              ? '观战中 · 仅公共信息'
              : view.status === 'finished'
              ? '对局已结束'
              : view.status === 'aborted'
              ? '对局已中止'
              : '等待对局开始',
          )
        } catch (error) {
          if (!controller.signal.aborted) setStatus(error instanceof Error ? error.message : '观战连接中断')
        } finally {
          if (!controller.signal.aborted) timer = setTimeout(() => void refresh(), 2000)
        }
      }
      await refresh()
    })().catch(error => {
      if (!controller.signal.aborted) setStatus(error instanceof Error ? error.message : '观战不可用')
    })
    return () => {
      controller.abort()
      clearTimeout(timer)
      dispose?.()
    }
  }, [room.sourceId, room.id, port, service])
  return (
    <aside className='gr-spectator' aria-label='观战'>
      <header className='gr-spectator-header'>
        <div className='gr-spectator-heading'>
          <Symbol name='watch' />
          <strong>观战</strong>
          <Button variant='ghost' className='gr-toolbar-icon' aria-label='退出观战' title='退出观战' onClick={close}>
            <Symbol name='close' size={16} />
          </Button>
        </div>
        <h2>{room.name}</h2>
        <p role='status'>{status}</p>
      </header>
      <div className='gr-spectator-scene' ref={element} aria-label='公共观战场景' />
      <footer className='gr-spectator-footer'>
        <p className='gr-muted'>不占席位 · 不投入资产</p>
      </footer>
    </aside>
  )
}
