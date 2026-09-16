import * as managedCodec from '@cordisx/protocol/managed-source/v1'
import { requireThat } from './errors.js'
import { loadManagedAccountTrust } from './managed-trust.js'
import { configuredAccessPolicy } from './access-policy.js'
import { createGameServer } from './http.js'
const port = Number(process.env.PORT ?? 8787)
const bindHost = process.env.BIND_HOST ?? '127.0.0.1'
const managedAccount = process.env.MANAGED_SOURCE_TRUST
  ? { trust: loadManagedAccountTrust(process.env.MANAGED_SOURCE_TRUST), codec: managedCodec }
  : undefined
if (managedAccount) {
  const host = bindHost === '::1' ? '[::1]' : bindHost
  requireThat(
    managedAccount.trust.binding.origin === new URL(`http://${host}:${port}`).origin,
    'managed_binding_mismatch',
  )
}
requireThat(
  !!process.env.SPEND_SERVICE_ORIGIN === !!process.env.SPEND_SERVICE_PRIVATE_KEY,
  'invalid_spend_configuration',
)
const app = createGameServer({
  managedAccount,
  accessPolicy: configuredAccessPolicy(process.env),
  ...(process.env.SPEND_SERVICE_ORIGIN && process.env.SPEND_SERVICE_PRIVATE_KEY
    ? {
      walletSpend: {
        origin: process.env.SPEND_SERVICE_ORIGIN,
        privateKey: process.env.SPEND_SERVICE_PRIVATE_KEY,
        trustedWalletPublicKeys: process.env.SPEND_TRUSTED_WALLET_KEYS
          ? JSON.parse(process.env.SPEND_TRUSTED_WALLET_KEYS)
          : [],
      },
    }
    : {}),
  database: process.env.DATABASE_PATH ?? '.data/game-room.sqlite',
  allowedOrigins: (process.env.ALLOWED_ORIGINS ?? '').split(',').filter(Boolean),
})
await app.engine.serial(() => app.engine.tick())
app.server.listen(port, bindHost, () => {
  console.log(`Game Room ${app.store.serverId} listening on ${JSON.stringify(app.server.address())}`)
})
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.once(signal, () => {
    void app.close().then(() => process.exit(0))
  })
}
