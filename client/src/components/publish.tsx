import { useEffect, useRef, useState } from 'cordisx/react'
import { Button, EmptyState, MarkdownEditor, Select } from 'cordisx/ui'
import type { SourceState } from '../data/model.js'
import { inspectPackage, PACKAGE_LIMIT, type PackagePreview } from '../data/package-upload.js'
import { Revision } from '../data/revision.js'
import { ConfirmationLayout } from './confirmation-layout.js'
import { Symbol } from './icons.js'
import '../styles/publish-replay.css'
export function PublishPanel({ states, publish, busy }: {
  states: SourceState[]
  publish: (sourceId: string, preview: PackagePreview) => Promise<void>
  busy: boolean
}) {
  const online = states.filter(state => state.state === 'online')
  const [sourceId, setSourceId] = useState(online[0]?.source.id ?? '')
  const source = online.find(state => state.source.id === sourceId)
  const [text, setText] = useState('')
  const [preview, setPreview] = useState<PackagePreview>()
  const [error, setError] = useState('')
  const [inspecting, setInspecting] = useState(false)
  const revision = useRef(new Revision())
  const file = useRef<HTMLInputElement>(null)
  const sourceKey = JSON.stringify([sourceId, source?.source.url, source?.source.accountId])
  useEffect(() => {
    revision.current.next()
    setPreview(undefined)
    setInspecting(false)
    return () => {
      revision.current.next()
    }
  }, [sourceKey])
  useEffect(() => {
    if (!sourceId && online[0]) setSourceId(online[0].source.id)
  }, [sourceId, online])
  const invalidate = () => {
    revision.current.next()
    setPreview(undefined)
    setError('')
    setInspecting(false)
  }
  const edit = (value: string) => {
    invalidate()
    setText(value)
  }
  const inspect = async () => {
    if (busy || inspecting || !text.trim()) return
    const token = revision.current.next()
    setInspecting(true)
    setPreview(undefined)
    setError('')
    try {
      const value = await inspectPackage(text)
      if (revision.current.current(token)) setPreview(value)
    } catch (error) {
      if (revision.current.current(token)) setError(error instanceof Error ? error.message : '无效游戏包')
    } finally {
      if (revision.current.current(token)) setInspecting(false)
    }
  }
  return (
    <ConfirmationLayout
      label='发布游戏包'
      summary={
        <aside className='gr-publish-summary' aria-label='检查摘要'>
          {preview
            ? (
              <>
                <div className='gr-confirmation-heading'>
                  <Symbol name='check' />
                  <strong>检查通过</strong>
                </div>
                <h2>{preview.name} · v{preview.version}</h2>
                <dl className='gr-confirmation-facts'>
                  <div>
                    <dt>发布来源</dt>
                    <dd>{source?.source.name ?? '未选择'}</dd>
                  </div>
                  <div>
                    <dt>作者账户</dt>
                    <dd>{source?.source.accountId || '当前连接账户'}</dd>
                  </div>
                  <div>
                    <dt>大小</dt>
                    <dd>{(preview.bytes / 1024).toFixed(1)} KiB</dd>
                  </div>
                  <div>
                    <dt>模式</dt>
                    <dd>{preview.modes.join(' / ')}</dd>
                  </div>
                </dl>
                <details className='gr-confirmation-ids'>
                  <summary>查看包摘要</summary>
                  <p>SHA-256 {preview.digest}</p>
                  <p>玩法：{preview.id}</p>
                </details>
                <p className='gr-muted'>发布后此版本内容固定。其他玩家加入时加载同一包，上传内容不会在本页执行。</p>
              </>
            )
            : (
              <EmptyState
                style={{ minHeight: 0, padding: 0, textAlign: 'left', alignItems: 'flex-start' }}
                title={inspecting ? '正在检查游戏包' : '等待检查'}
                description='导入或粘贴 JSON，再检查版本、模式与摘要。'
              />
            )}
        </aside>
      }
      footer={
        <>
          <span className='gr-muted'>GamePackage v1 · 最大 600 KiB · 不在页面执行上传代码</span>
          <Button
            variant='primary'
            className='gr-confirmation-submit'
            disabled={busy || !source || !preview || inspecting}
            onClick={() => {
              if (preview && source && !busy) void publish(sourceId, preview)
            }}
          >
            发布此版本
          </Button>
        </>
      }
    >
      <div className='gr-publish-toolbar'>
        <div className='gr-publish-source'>
          <Select
            aria-label='发布来源'
            value={sourceId}
            disabled={busy}
            options={online.map(state => ({ value: state.source.id, label: state.source.name }))}
            onChange={value => {
              invalidate()
              setSourceId(value)
            }}
          />
        </div>
        <Button
          variant='ghost'
          className='gr-toolbar-icon'
          aria-label='导入游戏包 JSON'
          title='导入游戏包 JSON'
          disabled={busy}
          onClick={() => file.current?.click()}
        >
          <Symbol name='plus' size={16} />
        </Button>
        <input
          className='gr-publish-file'
          ref={file}
          type='file'
          accept='.json,application/json'
          tabIndex={-1}
          onChange={event => {
            const selected = event.currentTarget.files?.[0]
            event.currentTarget.value = ''
            if (!selected) return
            invalidate()
            const token = revision.current.next()
            if (selected.size > PACKAGE_LIMIT) {
              setError('游戏包超过 600 KiB 上限')
              return
            }
            void selected.text().then(value => {
              if (revision.current.current(token)) setText(value)
            }).catch(() => {
              if (revision.current.current(token)) setError('无法读取文件')
            })
          }}
        />
      </div>
      {!source && <p className='gr-muted' role='status'>当前没有可发布的在线来源。</p>}
      <div className='gr-publish-editor'>
        <MarkdownEditor
          aria-label='游戏包 JSON'
          value={text}
          onValueChange={edit}
          placeholder='粘贴 GamePackage v1 JSON'
          disabled={busy}
          style={{ height: '100%', minHeight: 220 }}
        />
      </div>
      {error && <p className='gr-error' role='alert'>{error}</p>}
      <div>
        <Button disabled={busy || inspecting || !text.trim()} onClick={() => void inspect()}>
          {inspecting ? '检查中…' : '检查包信息'}
        </Button>
      </div>
    </ConfirmationLayout>
  )
}
