import { reconcileCreateSelection } from '../data/create-source-selection.js'
import type { CreatePreferences } from '../data/create-preferences.js'
import { TokenAmount } from './token-amount.js'
import { latestSourceGames } from '../data/game-catalog.js'
import { type CreateContext, resolveCreateSelection } from '../data/lobby-context.js'
import { useEffect, useMemo, useState } from 'cordisx/react'
import { Button, EmptyState, SchemaForm } from 'cordisx/ui'
import type { CreateRoom, SourceState } from '../data/model.js'
import { economyLabel } from '../data/model.js'
import { gameConfigForm, generalCreateSchema } from '../data/create-schema.js'
import { validateGameConfig } from '../../../sdk/game-config.mjs'
import { Symbol } from './icons.js'
import { CreateRoomPreview } from './create-room-preview.js'
import '../styles/create-room.css'

export function CreateRoomPanel(
  { states, create, busy, publish, configure, context, tokenAvailable, preferences, officialOrigins }: {
    preferences?: CreatePreferences
    officialOrigins?: readonly string[]
    states: SourceState[]
    context?: CreateContext
    tokenAvailable?: (sourceId: string) => boolean
    create: (sourceId: string, draft: CreateRoom) => void
    busy: boolean
    publish: () => void
    configure?: () => void
  },
) {
  const available = states.filter(state => state.state === 'online')
  const [initial] = useState(() =>
    reconcileCreateSelection(states, context, { sourceId: '', packageHash: '' }, {
      previous: preferences?.current,
      officialOrigins,
    })
  )
  const [sourceEdited, setSourceEdited] = useState(false)
  const [gameEdited, setGameEdited] = useState(false)
  const [preferenceRevision, setPreferenceRevision] = useState(0)
  useEffect(() => preferences?.subscribe(() => setPreferenceRevision(value => value + 1)), [preferences])
  const [sourceId, setSourceId] = useState(initial.sourceId)
  const source = available.find(state => state.source.id === sourceId)
  const sourceLoading = states.some(state =>
    state.state === 'loading' && (sourceId ? state.source.id === sourceId : !available.length)
  )
  const [gameId, setGameId] = useState(initial.packageHash)
  const catalog = latestSourceGames(source)
  const tokenReady = !source || !tokenAvailable || tokenAvailable(source.source.id)
  const game = catalog.find(item => item.packageHash === gameId)
  const selectedPackage = source?.snapshot?.games.find(item => item.packageHash === gameId)
  const [name, setName] = useState('朋友来一局')
  const [mode, setMode] = useState<CreateRoom['mode']>('score')
  const [stake, setStake] = useState('100')
  const [botCount, setBotCount] = useState(0)
  const [playerDraft, setPlayerDraft] = useState({
    key: JSON.stringify([sourceId, gameId]),
    value: game?.maxPlayers ?? 2,
  })
  const [agents, setAgents] = useState(true)
  const [accepted, setAccepted] = useState(false)
  const [tab, setTab] = useState('general')
  const [gameDraft, setGameDraft] = useState<{ key: string; value: Record<string, string | number | boolean> }>({
    key: '',
    value: {},
  })
  const identity = JSON.stringify([sourceId, gameId])
  const maxPlayers = playerDraft.key === identity ? playerDraft.value : game?.maxPlayers ?? 2
  const defaults = useMemo(() => game?.configSchema ? validateGameConfig(game.configSchema) : {}, [game?.configSchema])
  const config = gameDraft.key === identity ? gameDraft.value : defaults
  const gameSchema = useMemo(() => gameConfigForm(game?.configSchema), [game?.configSchema])
  const commonSchema = useMemo(
    () =>
      generalCreateSchema(
        states,
        sourceId,
        !tokenReady && game
          ? { ...game, modes: game.modes.filter(mode => mode !== 'token') }
          : game,
        mode === 'token',
        maxPlayers,
      ),
    [
      states,
      sourceId,
      game,
      mode,
      maxPlayers,
      tokenReady,
    ],
  )
  const commonValue = {
    sourceId,
    gameId,
    name,
    mode,
    ...(mode === 'token' ? { stake: Number(stake) } : {}),
    botCount,
    maxPlayers,
    allowAgents: agents,
  }
  let configValid = true
  try {
    if (game?.configSchema) validateGameConfig(game.configSchema, config)
  } catch {
    configValid = false
  }

  useEffect(() => {
    setAccepted(false)
  }, [sourceId, gameId, mode, stake, maxPlayers, JSON.stringify(config)])
  useEffect(() => {
    if (game && !game.modes.includes(mode)) setMode(game.modes[0] ?? 'score')
  }, [game, mode])
  useEffect(() => {
    if (!game) return
    const maximum = mode === 'token' || !game.rulesBot || !Number.isFinite(maxPlayers)
      ? 0
      : Math.max(0, Math.floor(maxPlayers) - 1)
    setBotCount(current => Math.min(current, maximum))
  }, [game, mode, maxPlayers])
  // Source refreshes must not remount the form or discard the user's draft.
  useEffect(() => {
    const next = reconcileCreateSelection(states, context, { sourceId, packageHash: gameId }, {
      previous: preferences?.current,
      officialOrigins,
      sourceEdited,
      gameEdited,
    })
    if (next.sourceId !== sourceId) setSourceId(next.sourceId)
    if (next.packageHash !== gameId) setGameId(next.packageHash)
  }, [states, context, sourceId, gameId, sourceEdited, gameEdited, preferences, preferenceRevision, officialOrigins])
  const validStake = Number.isSafeInteger(Number(stake)) && Number(stake) > 0
  let commonValid = true
  try {
    commonSchema(commonValue)
  } catch {
    commonValid = false
  }
  const disabled = (mode === 'token' && !tokenReady) || !configValid || !commonValid || busy || !source || !game
    || !name.trim()
    || !game.modes.includes(mode)
    || (mode === 'token' && (!accepted || !validStake))
  return (
    <section className='gr-create' aria-label='创建房间设置'>
      <div className='gr-create-workspace'>
        <section className='gr-create-editor'>
          {!source && (
            <p className='gr-notice' role='status'>
              {sourceLoading ? '正在加载服务器…' : sourceId ? '所选服务器当前不可用' : '没有可用服务器'}
              {!sourceLoading && configure && <Button variant='ghost' onClick={configure}>检查来源配置</Button>}
            </p>
          )}
          {source && gameId && !game && (
            <p className='gr-notice' role='status'>
              {selectedPackage
                ? `所选 v${selectedPackage.version} 已不是最新可用版本，请重新选择玩法。`
                : '所选玩法已不可用，请重新选择玩法。'}
            </p>
          )}
          {source && !gameId && catalog.some(item => catalog.filter(other => other.id === item.id).length > 1) && (
            <p className='gr-notice'>请选择玩法；同版本存在多个发布者时须明确选择。</p>
          )}
          {!tokenReady && game?.modes.includes('token') && (
            <p className='gr-muted' role='status'>本地钱包不可用或此来源不支持本地结算；Token 模式暂不可用。</p>
          )}
          <div className='gr-create-tabs' role='tablist' aria-label='房间配置'>
            {[{ id: 'general', label: '通用配置', icon: 'settings' }, {
              id: 'game',
              label: '游戏配置',
              icon: 'game',
            }].map((item, index) => (
              <Button
                key={item.id}
                variant='ghost'
                role='tab'
                id={`create-tab-${item.id}`}
                aria-controls={`create-panel-${item.id}`}
                aria-selected={tab === item.id}
                tabIndex={tab === item.id ? 0 : -1}
                onClick={() => setTab(item.id)}
                onKeyDown={event => {
                  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
                  event.preventDefault()
                  const next = event.key === 'Home'
                    ? 'general'
                    : event.key === 'End'
                    ? 'game'
                    : index
                    ? 'general'
                    : 'game'
                  setTab(next)
                  document.getElementById(`create-tab-${next}`)?.focus()
                }}
              >
                <Symbol name={item.id === 'general' ? 'settings' : 'game'} size={16} />
                {item.label}
              </Button>
            ))}
            <Button
              variant='ghost'
              className='gr-square-button gr-create-import'
              aria-label='导入或发布游戏包'
              title='导入或发布游戏包'
              onClick={publish}
            >
              <Symbol name='plus' />
            </Button>
          </div>
          <div
            className='gr-create-fields'
            role='tabpanel'
            id={`create-panel-${tab}`}
            aria-labelledby={`create-tab-${tab}`}
            tabIndex={0}
          >
            <div className='gr-create-form'>
              {tab === 'general'
                ? (
                  <SchemaForm
                    identity={`create-general:${identity}`}
                    schema={commonSchema}
                    value={commonValue}
                    locale='zh-CN'
                    disabled={busy}
                    onChange={({ value }) => {
                      const nextSource = typeof value.sourceId === 'string'
                          && available.some(state => state.source.id === value.sourceId)
                        ? value.sourceId
                        : sourceId
                      const nextGameId = nextSource !== sourceId
                        ? resolveCreateSelection(states, {
                          ...context,
                          gameId: game?.id ?? selectedPackage?.id ?? context?.gameId,
                          sourceId: nextSource,
                          chooseSource: false,
                          chooseGame: false,
                        }).packageHash
                        : catalog.some(item => item.packageHash === value.gameId)
                        ? String(value.gameId)
                        : gameId
                      const nextGame = latestSourceGames(states.find(state => state.source.id === nextSource)).find(
                        item => item.packageHash === nextGameId,
                      )
                      if (nextSource !== sourceId) {
                        setSourceEdited(true)
                        setGameEdited(false)
                        const selected = available.find(state => state.source.id === nextSource)
                        if (selected) preferences?.remember(selected.source)
                      } else if (nextGameId !== gameId) setGameEdited(true)
                      setSourceId(nextSource)
                      setGameId(nextGameId)
                      setName(String(value.name))
                      setAgents(value.allowAgents === true)
                      const nextPlayers = nextGameId !== gameId || nextSource !== sourceId
                        ? nextGame?.maxPlayers ?? 2
                        : Number(value.maxPlayers ?? maxPlayers)
                      setPlayerDraft({ key: JSON.stringify([nextSource, nextGameId]), value: nextPlayers })
                      const nextToken = value.mode === 'token'
                      const botMaximum = nextToken || !nextGame?.rulesBot || !Number.isFinite(nextPlayers)
                        ? 0
                        : Math.max(0, Math.floor(nextPlayers) - 1)
                      setBotCount(Math.min(Number(value.botCount ?? 0), botMaximum))
                      setMode(
                        nextGame?.modes.includes(value.mode as CreateRoom['mode'])
                          ? value.mode as CreateRoom['mode']
                          : nextGame?.modes[0] ?? 'score',
                      )
                      if (value.stake !== undefined) setStake(String(value.stake))
                    }}
                  />
                )
                : (
                  <>
                    {game?.configSchema
                      ? (
                        <SchemaForm
                          identity={identity}
                          schema={gameSchema}
                          value={config}
                          locale='zh-CN'
                          disabled={busy}
                          onChange={({ value }) =>
                            setGameDraft({ key: identity, value: value as Record<string, string | number | boolean> })}
                        />
                      )
                      : <EmptyState title='此版本使用固定规则' description={game?.description ?? '请先选择玩法'} />}
                  </>
                )}
            </div>
          </div>
        </section>
        <CreateRoomPreview
          game={game}
          name={name}
          source={source?.source}
          mode={mode}
          stake={mode === 'token' ? stake : ''}
          agents={agents}
          config={config}
        />
      </div>
      <footer className='gr-create-footer'>
        <div className='gr-create-footer-copy'>
          <span>
            {mode !== 'token' && <Symbol name={mode === 'score' ? 'score' : 'coins'} size={16} />}
            {economyLabel(mode)} · {mode === 'token'
              ? (
                <>
                  <TokenAmount value={validStake ? Number(stake) : undefined} /> / 席位
                </>
              )
              : '无需 Token'}
          </span>
          {mode === 'token' && (
            <label className='gr-check'>
              <input
                type='checkbox'
                checked={accepted}
                onChange={event => setAccepted(event.target.checked)}
              />我同意此版本规则、费用与退款政策
            </label>
          )}
        </div>
        <Button
          className='gr-create-submit'
          disabled={disabled}
          onClick={() => {
            if (disabled || !game) return
            if (source) preferences?.remember(source.source)
            create(sourceId, {
              config,
              name: name.trim(),
              gameId: game.id,
              packageHash: game.packageHash,
              gameVersion: game.version,
              mode,
              stake: mode === 'token' ? Number(stake) : 0,
              botCount,
              maxPlayers,
              allowAgents: agents,
              consentAccepted: accepted,
            })
          }}
        >
          <Symbol name='plus' size={18} />
          {busy ? '创建中…' : '创建房间'}
        </Button>
      </footer>
    </section>
  )
}
