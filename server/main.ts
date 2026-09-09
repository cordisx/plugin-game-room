import { createGameServer } from './http.js'
import { HttpEconomy } from './economy.js'
const economy = process.env.ECONOMY_URL && process.env.ECONOMY_SERVICE_TOKEN && process.env.ECONOMY_SERVICE_ID
  ? new HttpEconomy(process.env.ECONOMY_URL, process.env.ECONOMY_SERVICE_TOKEN, process.env.ECONOMY_SERVICE_ID)
  : undefined
const app = createGameServer({
  database: process.env.DATABASE_PATH ?? '.data/game-room.sqlite',
  economy,
  allowedOrigins: (process.env.ALLOWED_ORIGINS ?? '').split(',').filter(Boolean),
})
await app.engine.serial(() => app.engine.tick())
app.server.listen(Number(process.env.PORT ?? 8787), process.env.BIND_HOST ?? '127.0.0.1', () => {
  console.log(`Game Room ${app.store.serverId} listening on ${JSON.stringify(app.server.address())}`)
})
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.once(signal, () => {
    void app.close().then(() => process.exit(0))
  })
}
