import { verifyHtmlUi } from '../sdk/html-ui.mjs'
import { parseGameConfigSchema } from '../sdk/game-config.mjs'
import type { GamePackage, PackageMetadata } from '../sdk/index.js'
import { canonical, integer, object, requireThat } from './errors.js'
import { digest } from './accounts.js'
import { invoke, invokeBot, invokeUi } from './runner.js'
import type { GameStore as Store } from './store-contract.js'
export class Packages {
  constructor(private store: Store) {}
  async publish(publisherId: string, input: unknown): Promise<PackageMetadata> {
    object(input)
    object(input.manifest)
    object(input.ui)
    const m = input.manifest
    requireThat(m.waitingUi === undefined || typeof m.waitingUi === 'boolean', 'invalid_waiting_ui')
    requireThat(m.spectating === undefined || typeof m.spectating === 'boolean', 'invalid_spectating')
    if (m.minimumViewport !== undefined) {
      const viewport = m.minimumViewport
      requireThat(
        viewport !== null && typeof viewport === 'object' && !Array.isArray(viewport),
        'invalid_minimum_viewport',
      )
      const dimensions = viewport as Record<string, unknown>
      requireThat(
        integer(dimensions.width, 280, 1920) && integer(dimensions.height, 280, 1200),
        'invalid_minimum_viewport',
      )
    }
    if (m.configSchema !== undefined) {
      try {
        parseGameConfigSchema(m.configSchema)
      } catch {
        requireThat(false, 'invalid_config_schema')
      }
    }
    requireThat(input.packageVersion === 1 && typeof m.id === 'string' && /^[a-z0-9-]{1,64}$/.test(m.id))
    requireThat(typeof m.version === 'string' && /^\d{1,8}\.\d{1,8}\.\d{1,8}$/.test(m.version))
    requireThat(typeof m.name === 'string' && m.name.length > 0 && m.name.length <= 100)
    requireThat(integer(m.minPlayers, 2, 8) && integer(m.maxPlayers, m.minPlayers, 8))
    requireThat(
      Array.isArray(m.modes) && m.modes.length > 0 && m.modes.length <= 3
        && m.modes.every(x => ['score', 'local-chips', 'token'].includes(x as string)),
    )
    requireThat(
      m.settlementPolicies === undefined
        || (Array.isArray(m.settlementPolicies) && m.settlementPolicies.length > 0
          && m.settlementPolicies.every(x => ['equal-winners-v1', 'conserved-payouts-v1'].includes(x as string))),
    )
    requireThat(typeof input.rules === 'string' && input.rules.length <= 256 * 1024)
    if (input.ui.format === 'html-v1') {
      try {
        await verifyHtmlUi(input.ui, digest)
      } catch {
        requireThat(false, 'invalid_html_ui')
      }
    } else {
      requireThat(
        input.ui.format === 'scene-v1' && Object.keys(input.ui).every(key => ['format', 'render'].includes(key)),
        'unsupported_ui_format',
      )
      requireThat(typeof input.ui.render === 'string' && input.ui.render.length <= 256 * 1024, 'invalid_ui_renderer')
    }
    requireThat(m.playerExit === undefined || typeof m.playerExit === 'boolean', 'invalid_player_exit')
    requireThat(m.rulesBot === undefined || m.rulesBot === 'rules-bot-v1', 'unsupported_bot')
    requireThat((m.rulesBot !== undefined) === (input.bot !== undefined), 'invalid_bot')
    if (input.bot !== undefined) {
      object(input.bot)
      requireThat(
        input.bot.format === 'rules-bot-v1' && typeof input.bot.source === 'string'
          && input.bot.source.length <= 65536,
        'invalid_bot',
      )
      await invokeBot(input.bot.source, null, { seatIndex: 0, seatCount: 2, mode: 'score', canAct: false }, true)
    }
    const body = canonical(input)
    const hash = digest(body)
    const prior = await this.store.db.prepare(
      'SELECT hash FROM packages WHERE publisher_id=? AND game_id=? AND version=?',
    )
      .get(publisherId, m.id, m.version) as {
        hash: string
      } | undefined
    requireThat(!prior || prior.hash === hash, 'immutable_version', 409)
    await invoke({
      rules: input.rules,
      method: 'validate',
      args: m.playerExit ? ['exit'] : [],
      ctx: { seats: [], config: {}, seatIndex: null, mode: 'score', stake: 0, policy: 'equal-winners-v1' },
      seed: '',
      cursor: 0,
    })
    if (input.ui.format === 'scene-v1') {
      await invokeUi(
        {
          render: input.ui.render as string,
          observation: null,
          context: { seatIndex: 0, seatCount: 2, mode: 'score', canAct: false },
        },
        {},
        true,
      )
    }
    await this.store.atomic(async () => {
      const current = await this.store.db.prepare(
        'SELECT hash FROM packages WHERE publisher_id=? AND game_id=? AND version=?',
      ).get(publisherId, m.id as string, m.version as string)
      requireThat(!current || current.hash === hash, 'immutable_version', 409)
      await this.store.db.prepare('INSERT OR IGNORE INTO packages VALUES (?,?,?,?,?)').run(
        hash,
        publisherId,
        m.id as string,
        m.version as string,
        body,
      )
    })
    return await this.metadata(hash)
  }
  async get(hash: string): Promise<GamePackage> {
    const row = await this.store.db.prepare('SELECT body FROM packages WHERE hash=?').get(hash) as {
      body: string
    } | undefined
    requireThat(row, 'package_not_found', 404)
    return JSON.parse(row.body)
  }
  async metadata(hash: string): Promise<PackageMetadata> {
    const row = await this.store.db.prepare('SELECT publisher_id FROM packages WHERE hash=?').get(hash) as {
      publisher_id: string
    } | undefined
    requireThat(row, 'package_not_found', 404)
    const ui = (await this.get(hash)).ui
    return {
      hash,
      manifest: (await this.get(hash)).manifest,
      publisherId: row.publisher_id,
      reviewState: 'unreviewed',
      uiUrl: `/v1/packages/${hash}/ui`,
      uiSha256: digest(ui.format === 'scene-v1' ? ui.render : canonical(ui)),
      uiFormat: ui.format,
    }
  }
  async list() {
    return await Promise.all((await this.store.db.prepare('SELECT hash FROM packages').all() as {
      hash: string
    }[]).map(async (row) => await this.metadata(row.hash)))
  }
}
