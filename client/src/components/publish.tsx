import type { ReactElement } from 'cordisx/react'
import { useState } from 'cordisx/react'
import { Button, MarkdownEditor, Select } from 'cordisx/ui'
import type { SourceState } from '../data/model.js'
import { inspectPackage, PACKAGE_LIMIT, type PackagePreview } from '../data/package-upload.js'
export function PublishPanel(
  { states, publish, busy }: {
    states: SourceState[]
    publish: (sourceId: string, preview: PackagePreview) => Promise<void>
    busy: boolean
  },
): ReactElement {
  const [sourceId, setSourceId] = useState(states.find(state => state.state === 'online')?.source.id ?? '')
  const [text, setText] = useState('')
  const [preview, setPreview] = useState<PackagePreview>()
  const [error, setError] = useState('')
  const [inspecting, setInspecting] = useState(false)
  const edit = (value: string) => {
    setText(value)
    setPreview(undefined)
    setError('')
  }
  return (
    <div className='gr-detail'>
      <label className='gr-field'>
        发布来源<Select
          aria-label='发布来源'
          value={sourceId}
          options={states.filter(state => state.state === 'online').map(state => ({
            value: state.source.id,
            label: state.source.name,
          }))}
          onChange={setSourceId}
        />
      </label>
      <label className='gr-field'>
        导入游戏包 JSON<input
          type='file'
          accept='.json,application/json'
          onChange={event => {
            const file = event.currentTarget.files?.[0]
            if (!file) return
            if (file.size > PACKAGE_LIMIT) {
              setError('游戏包超过 600 KiB 上限')
              return
            }
            void file.text().then(edit).catch(() => setError('无法读取文件'))
          }}
        />
      </label>
      <MarkdownEditor
        aria-label='游戏包 JSON'
        value={text}
        onValueChange={edit}
        placeholder='粘贴 GamePackage v1 JSON'
      />
      {error && <div className='gr-error' role='alert'>{error}</div>}
      <Button
        disabled={busy || inspecting || !text.trim()}
        onClick={() => {
          setInspecting(true)
          void inspectPackage(text).then(setPreview).catch(error =>
            setError(error instanceof Error ? error.message : '无效游戏包')
          ).finally(() => setInspecting(false))
        }}
      >
        检查包信息
      </Button>
      {preview && (
        <div className='gr-record'>
          <strong>{preview.name} · v{preview.version}</strong>
          <span>
            作者账户：{states.find(state => state.source.id === sourceId)?.source.accountId || '当前连接账户'}
          </span>
          <span>大小 {(preview.bytes / 1024).toFixed(1)} KiB · {preview.modes.join(' / ')}</span>
          <span className='gr-code'>SHA-256 {preview.digest}</span>
          <p className='gr-muted'>发布后此版本内容固定。其他玩家加入房间时将加载同一包；上传内容不会在此页面执行。</p>
          <Button
            variant='primary'
            disabled={busy || !sourceId}
            onClick={() => {
              void publish(sourceId, preview)
            }}
          >
            发布此版本
          </Button>
        </div>
      )}
    </div>
  )
}
