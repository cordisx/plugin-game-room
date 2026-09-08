import { context, invoke } from './runtime.mjs'
export async function smoke(pkg) {
  for (const count of [...new Set([pkg.manifest.minPlayers, pkg.manifest.maxPlayers])]) {
    const ctx = context(count, {
      mode: pkg.manifest.modes[0],
      stake: 1000,
      policy: pkg.manifest.settlementPolicies?.[0] ?? 'equal-winners-v1',
    })
    const { value: setup } = await invoke(pkg.rules, 'setup', [], ctx)
    if (
      !setup || !Object.hasOwn(setup, 'state')
      || (!setup.done && (!Number.isInteger(setup.turn) || setup.turn < 0 || setup.turn >= count))
    ) throw Error('Invalid setup transition')
    for (let seat = 0; seat < count; seat++) {
      await invoke(pkg.rules, 'observe', [setup.state, seat], ctx)
    }
    if (!setup.done) {
      await invoke(pkg.rules, 'timeout', [setup.state], { ...ctx, seatIndex: setup.turn })
    }
  }
}
