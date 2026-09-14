import { createHmac } from 'node:crypto'
import { newQuickJSWASMModuleFromVariant, newVariant } from 'quickjs-emscripten-core'
import type { QuickJSSyncVariant } from '@jitl/quickjs-ffi-types'
import variant from '@jitl/quickjs-wasmfile-release-sync'
import wasmModule from './quickjs.wasm'
import type { Json, ViewContext } from '../../sdk/index.js'
import type { Invocation, RuntimeLimits } from '../runner.js'
import { ApiError } from '../errors.js'
export { transition } from '../runner-contract.js'

// Compiled WASM is bundled as a module, never dynamically compiled from bytes.
const modulePromise = newQuickJSWASMModuleFromVariant(
  newVariant(variant as unknown as QuickJSSyncVariant, { wasmModule }),
)
export async function invoke(input: Invocation, limits: RuntimeLimits = {}) {
  return launch({ ...input, kind: 'rules' }, limits)
}
export async function invokeUi(
  input: { render: string; observation: Json; context: ViewContext },
  limits: RuntimeLimits = {},
  validate = false,
) {
  return launch({ ...input, kind: 'ui', validate }, { ...limits, outputLimit: limits.outputLimit ?? 65536 })
}
export function invokeBot(source: string, observation: Json, context: ViewContext, validate = false) {
  return invokeUi({ render: `${source}\n;globalThis.render = globalThis.bot;`, observation, context }, {
    outputLimit: 16384,
  }, validate)
}
async function launch(
  input: Record<string, unknown> & {
    kind: string
    cursor?: number
    method?: string
    seed?: string
    rules?: string
    render?: string
    validate?: boolean
  },
  limits: RuntimeLimits,
): Promise<{ value: Json; cursor: number }> {
  const module = await modulePromise
  // No await occurs while a guest is alive: one guest per isolate, with a fresh runtime/context.
  const runtime = module.newRuntime()
  runtime.setMemoryLimit(16 * 1024 * 1024)
  runtime.setMaxStackSize(256 * 1024)
  let fuel = 1000
  runtime.setInterruptHandler(() => --fuel <= 0)
  const context = runtime.newContext()
  let cursor = input.kind === 'ui' ? 0 : input.cursor ?? 0
  try {
    if (input.kind !== 'ui') {
      const random = context.newFunction('__platformRandom', () => {
        if (input.method === 'observe' || cursor - (input.cursor ?? 0) >= 10000) throw new Error('random_budget')
        const bytes = createHmac('sha256', input.seed ?? '').update(String(cursor++)).digest()
        return context.newNumber(bytes.readUIntBE(0, 6) / 281474976710656)
      })
      context.setProp(context.global, '__platformRandom', random)
      random.dispose()
    }
    const ui = input.kind === 'ui'
    const payload = JSON.stringify(
      ui ? { observation: input.observation, context: input.context } : { args: input.args, ctx: input.ctx },
    )
    const prepare = ui
      ? 'Object.freeze(data.context);'
      : 'data.ctx.random=globalThis.__platformRandom;delete globalThis.__platformRandom;Object.freeze(data.ctx.seats);Object.freeze(data.ctx);'
    const call = ui
      ? `if(typeof globalThis.render!=='function')throw Error('missing_entry');${
        input.validate ? "return 'null';" : ''
      }const result=globalThis.render(data.observation,data.context);`
      : `${
        input.method === 'validate'
          ? "for(const key of ['setup','act','timeout','observe'])if(typeof globalThis.game?.[key]!=='function')throw Error('missing_entry');return 'null';"
          : ''
      }const result=globalThis.game[${JSON.stringify(input.method)}](...data.args,data.ctx);`
    const result = context.evalCode(`(()=>{try{return 'V'+(()=>{
      Object.defineProperty(globalThis,'Date',{value:undefined,writable:false,configurable:false});
      Object.defineProperty(Math,'random',{value:undefined,writable:false,configurable:false});Object.freeze(Math);
      const encode=JSON.stringify.bind(JSON);const data=JSON.parse(${JSON.stringify(payload)});${prepare}
      ${ui ? input.render : input.rules}\n;${call}
      if(result&&typeof result.then==='function')throw Error('async_forbidden');
      const output=encode(result);if(typeof output!=='string'||output.length>${
      limits.outputLimit ?? 256 * 1024
    })throw Error('output_limit');return output;
    })()}catch(error){return error?.message==='invalid_action'?'Einvalid_action':'Erule_failure'}})()`)
    if (result.error) {
      // Error objects may themselves have hostile getters. Never traverse them in the host.
      result.error.dispose()
      throw new ApiError(422, fuel <= 0 ? 'runtime_limit' : 'rule_failure')
    }
    const encoded = context.getString(result.value)
    result.value.dispose()
    if (encoded.startsWith('E')) throw new ApiError(422, encoded.slice(1))
    return { value: JSON.parse(encoded.slice(1)), cursor }
  } finally {
    context.dispose()
    runtime.dispose()
  }
}
