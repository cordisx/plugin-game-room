import { createHmac } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { getQuickJS } from 'quickjs-emscripten'
export async function source(name) {
  const names = name === 'holdem' ? ['evaluate.js', 'rules.js'] : ['rules.js']
  return (await Promise.all(
    names.map(file => readFile(new URL(`../${name}/${file}`, import.meta.url), 'utf8')),
  )).join('\n')
}
// Uses a new real QuickJS runtime for every entry. Server integration is separate.
export async function invoke(rules, method, args, ctx, seed = 'fixture', cursor = 0) {
  const module = await getQuickJS()
  const runtime = module.newRuntime()
  runtime.setMemoryLimit(16 * 1024 * 1024)
  runtime.setMaxStackSize(256 * 1024)
  const deadline = performance.now() + 1000
  runtime.setInterruptHandler(() => performance.now() > deadline)
  const startCursor = cursor
  const vm = runtime.newContext()
  const random = vm.newFunction('random', () => {
    if (method === 'observe') throw Error('random_in_observation')
    if (cursor - startCursor >= 10000) throw Error('random_budget')
    const bytes = createHmac('sha256', seed).update(String(cursor++)).digest()
    return vm.newNumber(bytes.readUIntBE(0, 6) / 281474976710656)
  })
  vm.setProp(vm.global, '__random', random)
  random.dispose()
  try {
    const result = vm.evalCode(
      `Date=undefined;Math.random=undefined;${rules}\nconst ctx=${
        JSON.stringify(ctx)
      };ctx.random=__random;JSON.stringify(game[${JSON.stringify(method)}](...${
        JSON.stringify(args)
      },ctx));`,
    )
    if (result.error) {
      const error = vm.dump(result.error)
      result.error.dispose()
      throw Error(error.message)
    }
    const encoded = vm.getString(result.value)
    if (encoded.length > 256 * 1024) {
      result.value.dispose()
      throw Error('output_limit')
    }
    result.value.dispose()
    const value = JSON.parse(encoded)
    return { value, cursor }
  } finally {
    vm.dispose()
    runtime.dispose()
  }
}
export function context(count = 2, overrides = {}) {
  return {
    seats: Array.from({ length: count }, (_, i) => `seat-${i}`),
    seatIndex: null,
    config: {},
    mode: 'local-chips',
    stake: 0,
    policy: 'equal-winners-v1',
    ...overrides,
  }
}
