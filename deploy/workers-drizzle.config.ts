import { defineConfig } from 'drizzle-kit'
export default defineConfig({
  dialect: 'sqlite',
  schema: './deploy/workers-schema.ts',
  out: './server/workers/migrations',
})
