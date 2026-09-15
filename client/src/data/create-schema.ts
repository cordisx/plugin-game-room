import { latestSourceGames } from './game-catalog.js'
import Schema from '@deepseek-ai/schemastery'
import type { Game, SourceState } from './model.js'
import { economyLabel } from './model.js'
import { type GameConfigSchema, parseGameConfigSchema } from '../../../sdk/game-config.mjs'
const label = (schema: Schema, text: string) => schema.extra('extra', { label: text })
const withIcon = (schema: Schema, icon: string) =>
  schema.extra('extra', { ...schema.meta.extra, cordisxForm: { icon } })
/** Data-only remote fields are compiled through safe factories, never Schema(serializedCallbacks). */
export function gameConfigForm(input?: GameConfigSchema) {
  if (!input) return Schema.object({})
  const schema = parseGameConfigSchema(input)
  return Schema.object(Object.fromEntries(
    Object.entries(schema.properties).map(([key, field]) => {
      let node: Schema = field.enum
        ? Schema.union(field.enum.map(value => Schema.const(value)))
        : field.type === 'boolean'
        ? Schema.boolean()
        : field.type === 'string'
        ? Schema.string()
        : Schema.number()
      if (field.minimum !== undefined) node = node.min(field.minimum)
      if (field.maximum !== undefined) node = node.max(field.maximum)
      if (field.minLength !== undefined) node = node.min(field.minLength)
      if (field.maxLength !== undefined) node = node.max(field.maxLength)
      if (field.type === 'integer' && !field.enum) node = node.step(1)
      if (field.description) node = node.description(field.description)
      return [key, label(node.default(field.default), field.title ?? key)]
    }),
  ))
}
export function generalCreateSchema(
  states: SourceState[],
  sourceId: string,
  game?: Game,
  token = false,
  maxPlayers = game?.maxPlayers ?? 2,
  tokenHint?: string,
) {
  const available = states.filter(state => state.state === 'online')
  const hideSource = available.length === 1 && available[0]?.source.id === sourceId
  const source = states.find(state => state.source.id === sourceId)
  const games = latestSourceGames(source)
  const choice = (values: { value: string; name: string }[]) =>
    Schema.union(values.map(item => label(Schema.const(item.value), item.name)))
  const form = Schema.object({
    ...(!hideSource
      ? {
        sourceId: label(
          choice(
            states.filter(state => state.state === 'online').map(state => ({
              value: state.source.id,
              name: state.source.name,
            })),
          ).default(sourceId).required(),
          '服务器',
        ),
      }
      : {}),
    gameId: label(
      choice(
        games.map(item => ({
          value: item.packageHash,
          name: `${item.name} · v${item.version}${
            games.filter(other => other.id === item.id).length > 1 ? ` · ${item.publisherId}` : ''
          }`,
        })),
      ).default(game?.packageHash ?? '').required(),
      '玩法',
    ),
    name: label(Schema.string().min(1).max(100).default('朋友来一局').required(), '房间名称'),
    mode: label(
      choice((game?.modes ?? ['score']).map(value => ({ value, name: economyLabel(value) }))).default(
        game?.modes[0] ?? 'score',
      ).required(),
      '计分方式',
    ),
    ...(token ? { stake: label(Schema.natural().min(1).max(1000000).required(), '每席位费用') } : {}),
    maxPlayers: label(
      Schema.natural().min(game?.minPlayers ?? 2).max(game?.maxPlayers ?? 2).default(game?.maxPlayers ?? 2).required()
        .disabled((game?.minPlayers ?? 2) === (game?.maxPlayers ?? 2))
        .description(`至少 ${game?.minPlayers ?? 2} 人即可开局，无需坐满；含房主、电脑和 Agent，不含观战`),
      '最大人数',
    ),
    botCount: label(
      Schema.natural().max(
        token || !game?.rulesBot ? 0 : Number.isFinite(maxPlayers) ? Math.max(0, Math.floor(maxPlayers) - 1) : 0,
      ).default(0)
        .description(
          token
            ? 'Token 房间不支持规则电脑'
            : !game?.rulesBot
            ? '此来源或游戏包尚未支持规则电脑'
            : '自动按游戏规则行动，不调用大模型',
        ),
      '规则电脑数量',
    ),
    allowAgents: label(Schema.boolean().default(true), '允许 Agent 加入'),
  })
  if (tokenHint) form.dict!.mode.description(tokenHint)
  for (const node of Object.values(form.dict ?? {})) withIcon(node, 'host:settings')
  return form
}
