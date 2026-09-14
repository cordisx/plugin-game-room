import { useEffect, useRef, useState } from 'cordisx/react'
import Schema from '@deepseek-ai/schemastery'
import { Button, EmptyState, SchemaForm } from 'cordisx/ui'
import type { GameRoomPort } from '../data/port.js'
import type { Seat } from '../data/model.js'
import { readInvitation } from '../data/invitation-preview.js'
import { Symbol } from './icons.js'
import { RoomSummary } from './room-summary.js'
import '../styles/source-invite.css'
const schema = Schema.object({ invitation: Schema.string().required().extra('extra', { label: '邀请' }) })
export function InvitePanel(
  { port, joined, settings }: { port: GameRoomPort; joined: (seat: Seat) => void; settings: () => void },
) {
  const [text, setText] = useState('')
  const [preview, setPreview] = useState<Awaited<ReturnType<typeof readInvitation>>>()
  const [status, setStatus] = useState<'idle' | 'loading' | 'joining'>('idle')
  const [error, setError] = useState('')
  const current = useRef<AbortController | undefined>(undefined)
  const revision = useRef(0)
  const sourceIdentity = JSON.stringify(port.sources.map(source => [source.id, source.url, source.enabled]))
  useEffect(() => {
    current.current?.abort()
    current.current = undefined
    revision.current++
    setPreview(undefined)
    setStatus('idle')
    setError('')
    return () => {
      current.current?.abort()
      revision.current++
    }
  }, [port, sourceIdentity])
  const change = (value: string) => {
    current.current?.abort()
    revision.current++
    setText(value)
    setPreview(undefined)
    setError('')
    setStatus('idle')
  }
  const read = async (join: boolean) => {
    if (status !== 'idle' || (join && !preview) || current.current && !current.current.signal.aborted) return
    const controller = new AbortController()
    current.current = controller
    const requestRevision = revision.current
    setError('')
    setStatus(join ? 'joining' : 'loading')
    try {
      const next = await readInvitation(port, text, controller.signal)
      if (join) {
        if (port.kind === 'live' && !port.isConnected?.(next.source.id)) {
          if (!port.connect) throw new Error('此连接无法建立游戏身份，请查看来源设置')
          await port.connect(next.source.id)
          controller.signal.throwIfAborted()
        }
        // Connection may take time; check capacity and source identity again before joining.
        const checked = await readInvitation(port, text, controller.signal)
        const seat = await port.join(checked.invitation, controller.signal)
        if (!controller.signal.aborted && requestRevision === revision.current) joined(seat)
      } else if (!controller.signal.aborted && requestRevision === revision.current) setPreview(next)
    } catch (error) {
      if (!controller.signal.aborted && requestRevision === revision.current) {
        setPreview(undefined)
        setError(error instanceof Error ? error.message : '邀请读取失败')
      }
    } finally {
      if (!controller.signal.aborted && requestRevision === revision.current) setStatus('idle')
      if (current.current === controller) current.current = undefined
    }
  }
  return (
    <section className='gr-invite-layout' aria-label='邀请预览'>
      <div className='gr-invite-editor'>
        <SchemaForm
          identity='room-invitation'
          schema={schema}
          value={{ invitation: text }}
          locale='zh-CN'
          disabled={status === 'joining'}
          onChange={({ value }) => change(String(value.invitation ?? ''))}
        />
        <p className='gr-muted'>粘贴完整邀请 ID（game-room:v1:…）。来源地址须与已配置来源一致；解析只读取房间。</p>
        <div className='gr-action-row'>
          <Button
            variant={preview ? 'secondary' : 'primary'}
            disabled={status !== 'idle' || !text.trim()}
            onClick={() => void read(false)}
          >
            {status === 'loading' ? '读取房间中…' : '解析邀请'}
          </Button>
          <Button
            variant='ghost'
            className='gr-square-button'
            aria-label='查看来源'
            title='查看来源'
            onClick={settings}
          >
            <Symbol name='source' />
          </Button>
        </div>
        {error && <p className='gr-error' role='alert'>{error}</p>}
        {preview && <p className='gr-muted'>已匹配 {preview.source.name}，请确认房间后加入。</p>}
      </div>
      <div className='gr-invite-preview'>
        {preview
          ? (
            <>
              <RoomSummary room={preview.room} sources={port.sources} />
              <div className='gr-invite-join'>
                <Button variant='primary' disabled={status !== 'idle'} onClick={() => void read(true)}>
                  {status === 'joining' ? '正在进入…' : preview.room.owned ? '返回房间' : '加入房间'}
                </Button>
              </div>
            </>
          )
          : (
            <EmptyState
              style={{ minHeight: 0, padding: '24px 0' }}
              title={status === 'loading' ? '正在读取房间' : '等待解析邀请'}
              description='粘贴完整邀请后查看房间和来源。'
            />
          )}
      </div>
    </section>
  )
}
