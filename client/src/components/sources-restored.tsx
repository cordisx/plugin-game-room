import { useEffect, useRef, useState } from 'cordisx/react'
import { Button, EmptyState } from 'cordisx/ui'
import type { GameRoomPort } from '../data/port.js'
import type { SourceState } from '../data/model.js'
import { RecordDetails } from './panel-state.js'
import { Symbol } from './icons.js'
import '../styles/source-invite.css'
export function SourcesPanel(
  { states, port, configure, changed }: {
    states: SourceState[]
    port: GameRoomPort
    configure: () => void
    changed: () => void
  },
) {
  const [selected, setSelected] = useState('')
  const [persistedLink, setPersistedLink] = useState(false)
  const [busy, setBusy] = useState(false)
  const [local, setLocal] = useState<Record<string, SourceState>>({})
  const [messages, setMessages] = useState<Record<string, string>>({})
  const [economy, setEconomy] = useState<Record<string, 'connected' | 'linked'>>({})
  const request = useRef<AbortController | undefined>(undefined)
  const sourceIdentity = JSON.stringify(
    port.sources.map(source => [source.id, source.url, source.accountId, source.enabled]),
  )
  useEffect(() => {
    request.current?.abort()
    request.current = undefined
    setBusy(false)
    setLocal({})
    setEconomy({})
    setMessages({})
    return () => request.current?.abort()
  }, [port, sourceIdentity])
  const state = states.find(state => state.source.id === selected) ?? states[0]
  const active = state && (local[state.source.id] ?? state)
  const source = active?.source
  const online = active?.state === 'online'
  const walletUnavailable = port.walletMode?.() === 'canonical-local'
    && (!source || !port.economyAvailable?.(source.id))
  useEffect(() => {
    const controller = new AbortController()
    setPersistedLink(false)
    if (source && online && !busy && !walletUnavailable && port.economyLinked) {
      void port.economyLinked(source.id, controller.signal).then(linked => {
        if (!controller.signal.aborted) setPersistedLink(linked)
      }).catch(() => {})
    }
    return () => controller.abort()
  }, [port, source?.id, online, busy, walletUnavailable])
  const guestAccess = source && (
    (port.allowsGuests?.(source.id) ?? active?.snapshot?.guestAccess === true)
    || port.connectionKind?.(source.id) === 'guest'
  )
  const connected = source && port.isConnected?.(source.id)
  const status = (state: SourceState) =>
    state.state === 'loading'
      ? '连接中'
      : state.state !== 'online'
      ? '不可用'
      : port.isConnected?.(state.source.id)
      ? port.connectionKind?.(state.source.id) === 'guest' ? '访客已连接' : '账户已连接'
      : '服务在线'
  const run = async (action: 'refresh' | 'login' | 'logout' | 'economy' | 'link') => {
    if (!source || request.current || (action === 'link' && economy[source.id] !== 'connected')) return
    const id = source.id
    const controller = new AbortController()
    request.current = controller
    setBusy(true)
    setMessages(value => ({ ...value, [id]: '' }))
    if (action === 'login' || action === 'economy') {
      setEconomy(value => {
        const next = { ...value }
        delete next[id]
        return next
      })
    }
    try {
      if (action === 'refresh') {
        setLocal(value => ({ ...value, [id]: { source, state: 'loading' } }))
        await port.prepareSource?.(source, controller.signal)
        const snapshot = await port.list(source, controller.signal)
        controller.signal.throwIfAborted()
        setLocal(value => ({
          ...value,
          [id]: { source, state: snapshot.compatible ? 'online' : 'incompatible', snapshot, error: snapshot.reason },
        }))
      } else if (action === 'logout') {
        await port.disconnect!(id)
        controller.signal.throwIfAborted()
      } else if (action === 'login') {
        await port.connect!(id, port.usesCodexAccount?.(id) || !guestAccess ? 'account' : undefined)
        controller.signal.throwIfAborted()
        setEconomy(value => {
          const next = { ...value }
          delete next[id]
          return next
        })
      } else if (action === 'economy') {
        await port.connectEconomy!(id, controller.signal)
        controller.signal.throwIfAborted()
        setEconomy(value => ({ ...value, [id]: 'connected' }))
      } else {
        await port.linkEconomy!(id, controller.signal)
        controller.signal.throwIfAborted()
        setEconomy(value => ({ ...value, [id]: 'linked' }))
      }
      if (action !== 'refresh') changed()
    } catch (error) {
      if (!controller.signal.aborted) {
        const message = error instanceof Error ? error.message : '操作失败'
        setMessages(value => ({ ...value, [id]: message }))
        if (action === 'refresh') setLocal(value => ({ ...value, [id]: { source, state: 'offline', error: message } }))
      }
    } finally {
      if (request.current === controller) request.current = undefined
      if (!controller.signal.aborted) setBusy(false)
    }
  }
  if (!source || !active) {
    return (
      <EmptyState
        title='暂无来源'
        description='添加一个游戏来源后查看房间。'
        action={<Button onClick={configure}>配置来源</Button>}
      />
    )
  }
  const unavailable = port.kind !== 'live' || port.capabilities?.().account === false
  return (
    <section className='gr-sources-layout'>
      <div className='gr-sources-list'>
        <div className='gr-panel-heading'>
          <h2 className='gr-section-title'>数据来源</h2>
          <Button
            variant='ghost'
            className='gr-square-button'
            aria-label='配置来源'
            title='配置来源'
            onClick={configure}
          >
            <Symbol name='settings' />
          </Button>
        </div>
        {states.map(state => (
          <Button
            key={state.source.id}
            variant='ghost'
            className='gr-source-option'
            aria-pressed={state.source.id === source.id}
            onClick={() => setSelected(state.source.id)}
          >
            <Symbol name='source' size={22} />
            <span>
              <strong>{state.source.name}</strong>
              <small>{status(local[state.source.id] ?? state)}</small>
            </span>
            <Symbol name='external' />
          </Button>
        ))}
      </div>
      <div className='gr-source-content'>
        <div className='gr-panel-heading'>
          <div>
            <strong>{source.name}</strong>
            <p className='gr-muted'>{status(active)}</p>
          </div>
          <div className='gr-action-row'>
            <RecordDetails label='查看来源标识'>
              <span>{source.url}</span>
              <span>来源：{source.id}</span>
              <span>协议：{active.snapshot?.protocol ?? '未知'}</span>
              <span>配置账户：{source.accountId || '未配置'}</span>
              <span>来源账号显示名：{source.accountDisplayName?.trim() || '使用当前 Codex 名称'}</span>
            </RecordDetails>
            <Button
              variant='ghost'
              className='gr-square-button'
              aria-label='重新连接此来源'
              title='重新连接此来源'
              disabled={busy}
              onClick={() => void run('refresh')}
            >
              <Symbol name='reset' />
            </Button>
          </div>
        </div>
        {(messages[source.id] || active.error) && (
          <p className='gr-error' role='alert'>{messages[source.id] || active.error}</p>
        )}
        <div>
          <Button
            variant='primary'
            disabled={busy || (!online && !port.usesCodexAccount?.(source.id)) || unavailable || !port.connect
              || (guestAccess && connected && !port.usesCodexAccount?.(source.id))}
            onClick={() => void run('login')}
          >
            {port.usesCodexAccount?.(source.id)
              ? connected ? '使用当前 Codex 重新登录' : '使用当前 Codex 登录'
              : guestAccess
              ? connected
                ? port.connectionKind?.(source.id) === 'guest' ? '访客已连接' : '账户已连接'
                : '连接访客'
              : '使用账户令牌连接'}
          </Button>
        </div>
        {connected && port.disconnect && (
          <Button disabled={busy} onClick={() => void run('logout')}>退出此来源账户</Button>
        )}
        <p className='gr-muted'>
          {guestAccess ? '此来源允许游客。' : '此来源必须登录。'}
          {port.usesCodexAccount?.(source.id) ? ' 使用当前 Codex 身份连接，账号显示名可在来源配置中修改。' : ''}
        </p>
        {guestAccess && !port.usesCodexAccount?.(source.id) && (
          <p className='gr-muted'>
            此来源支持访客连接，无需配置服务器访问密钥。游戏账户登录是独立流程。
          </p>
        )}
        <dl className='gr-source-facts'>
          <div>
            <dt>游戏账户</dt>
            <dd>
              {port.isConnected?.(source.id)
                ? port.connectionKind?.(source.id) === 'guest' ? '访客' : '已连接'
                : '未连接'}
            </dd>
          </div>
          <div>
            <dt>本地钱包</dt>
            <dd>
              {persistedLink || economy[source.id] === 'linked'
                ? '已确认绑定'
                : economy[source.id] === 'connected'
                ? '本次已连接'
                : '尚未在此确认连接'}
            </dd>
          </div>
        </dl>
        <div className='gr-action-row'>
          <Button
            variant='ghost'
            className='gr-square-button'
            aria-label='确认本地钱包连接'
            title='确认本地钱包连接'
            disabled={busy || !online || unavailable || walletUnavailable || !port.connectEconomy}
            onClick={() => void run('economy')}
          >
            <Symbol name='link' />
          </Button>
          <Button
            variant='ghost'
            className='gr-square-button'
            aria-label='绑定本地钱包'
            title='绑定本地钱包'
            disabled={busy || !online || unavailable || walletUnavailable || !port.linkEconomy
              || economy[source.id] !== 'connected'}
            onClick={() => void run('link')}
          >
            <Symbol name='check' />
          </Button>
          <span className='gr-muted'>
            {walletUnavailable
              ? '唯一本地钱包不可用或此来源不支持本地结算'
              : persistedLink
              ? '此游戏账户已绑定本地钱包'
              : '先确认本地钱包连接，再确认绑定此来源'}
          </span>
        </div>
      </div>
    </section>
  )
}
