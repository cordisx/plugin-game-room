import { parentPort, workerData } from 'node:worker_threads'
import { createHmac } from 'node:crypto'
import { newQuickJSWASMModule } from 'quickjs-emscripten'

// Uploaded source is interpreted exclusively in this fresh WebAssembly guest.
// The worker is a second availability boundary, not the code sandbox itself.
const input = workerData
const module = await newQuickJSWASMModule()
const runtime = module.newRuntime()
runtime.setMemoryLimit(16 * 1024 * 1024)
runtime.setMaxStackSize(256 * 1024)
const deadline = performance.now() + input.cpuMs
runtime.setInterruptHandler(() => performance.now() > deadline)
const context = runtime.newContext()
let cursor = input.cursor
const random = context.newFunction('__platformRandom', () => {
  if (input.method === 'observe' || cursor - input.cursor >= 10000) throw new Error('random_budget')
  const bytes = createHmac('sha256', input.seed).update(String(cursor++)).digest()
  return context.newNumber(bytes.readUIntBE(0, 6) / 281474976710656)
})
context.setProp(context.global, '__platformRandom', random)
random.dispose()
try {
  const bootstrap = context.evalCode(`
    Object.defineProperty(globalThis, 'Date', {value: undefined, writable: false, configurable: false});
    Object.defineProperty(Math, 'random', {value: undefined, writable: false, configurable: false});
    Object.freeze(Math);
  `)
  if (bootstrap.error) {
    bootstrap.error.dispose()
    throw new Error('bootstrap')
  }
  bootstrap.value.dispose()
  const payload = JSON.stringify({ args: input.args, ctx: input.ctx })
  const result = context.evalCode(
    `(() => {
    const encode = JSON.stringify.bind(JSON);
    const data = JSON.parse(${JSON.stringify(payload)});
    data.ctx.random = globalThis.__platformRandom;
    delete globalThis.__platformRandom;
    Object.freeze(data.ctx.seats); Object.freeze(data.ctx);
    ${input.rules}\n;
    if (${JSON.stringify(input.method)} === 'validate') {
      for (const key of ['setup','act','timeout','observe']) if (typeof globalThis.game?.[key] !== 'function') throw Error('missing_entry');
      return 'null';
    }
    if (!globalThis.game || typeof globalThis.game[${
      JSON.stringify(input.method)
    }] !== 'function') throw Error('missing_entry');
    const result = globalThis.game[${JSON.stringify(input.method)}](...data.args, data.ctx);
    if (result && typeof result.then === 'function') throw Error('async_forbidden');
    const output = encode(result);
    if (typeof output !== 'string' || output.length > ${input.outputLimit}) throw Error('output_limit');
    return output;
  })()`,
    'rules.js',
  )
  if (result.error) {
    const failure = context.dump(result.error)
    result.error.dispose()
    parentPort!.postMessage({ ok: false, error: String(failure?.message ?? 'guest_failure').slice(0, 200) })
  } else {
    const encoded = context.getString(result.value)
    result.value.dispose()
    parentPort!.postMessage({ ok: true, value: JSON.parse(encoded), cursor })
  }
} catch {
  parentPort!.postMessage({ ok: false, error: 'guest_failure' })
} finally {
  context.dispose()
  runtime.dispose()
}
