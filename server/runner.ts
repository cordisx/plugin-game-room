import { Worker } from 'node:worker_threads'
import type { Json, Mode, SettlementPolicy, Transition, ViewContext } from '../sdk/index.js'
import { ApiError, integer, object, requireThat } from './errors.js'

export interface Invocation {
  rules: string
  method: 'setup' | 'act' | 'timeout' | 'observe' | 'validate'
  args: Json[]
  ctx: {
    participants?: { name: string; kind: string }[]
    seats: string[]
    config: Json
    seatIndex: number | null
    mode: Mode
    stake: number
    policy: SettlementPolicy
  }
  seed: string
  cursor: number
}
export interface RuntimeLimits {
  cpuMs?: number
  wallMs?: number
  outputLimit?: number
}
export function invoke(input: Invocation, limits: RuntimeLimits = {}): Promise<{ value: Json; cursor: number }> {
  return launch({ ...input, kind: 'rules' }, limits)
}
export function invokeUi(
  input: { render: string; observation: Json; context: ViewContext },
  limits: RuntimeLimits = {},
  validate = false,
): Promise<{ value: Json; cursor: number }> {
  // This worker payload deliberately has no rule source, state, seed or account data.
  return launch(
    { kind: 'ui', render: input.render, observation: input.observation, context: input.context, validate },
    { ...limits, outputLimit: limits.outputLimit ?? 65536 },
  )
}
/** Independent strategy source receives only the seat projection and public UI context.
 * No rules, state, RNG seed/cursor, account identities or platform random are sent. */
export function invokeBot(source: string, observation: Json, context: ViewContext, validate = false) {
  return invokeUi({ render: `${source}\n;globalThis.render = globalThis.bot;`, observation, context }, {
    outputLimit: 16384,
  }, validate)
}
function launch(input: Record<string, unknown>, limits: RuntimeLimits): Promise<{ value: Json; cursor: number }> {
  return new Promise((resolve, reject) => {
    const extension = import.meta.url.endsWith('.ts') ? 'ts' : 'js'
    const worker = new Worker(new URL(`./runner-worker.${extension}`, import.meta.url), {
      workerData: { ...input, cpuMs: limits.cpuMs ?? 100, outputLimit: limits.outputLimit ?? 256 * 1024 },
      execArgv: [],
      resourceLimits: { maxOldGenerationSizeMb: 64, stackSizeMb: 4 },
    })
    let complete = false
    const finish = (error?: Error, value?: { value: Json; cursor: number }) => {
      if (complete) return
      complete = true
      clearTimeout(timer)
      void worker.terminate()
      if (error) reject(error)
      else resolve(value!)
    }
    const timer = setTimeout(() => finish(new ApiError(422, 'runtime_limit')), limits.wallMs ?? 3000)
    worker.once('message', message =>
      message.ok
        ? finish(undefined, { value: message.value, cursor: message.cursor })
        : finish(new ApiError(422, message.error === 'invalid_action' ? 'invalid_action' : 'rule_failure')))
    worker.once('error', () => finish(new ApiError(422, 'runtime_failure')))
    worker.once('exit', () => {
      if (!complete) finish(new ApiError(422, 'runtime_failure'))
    })
  })
}
export { transition } from './runner-contract.js'
