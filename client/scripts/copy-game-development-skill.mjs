import { cp, mkdir } from 'node:fs/promises'
const source = new URL('../src/skills/', import.meta.url)
const target = new URL('../dist/runtime/skills/', import.meta.url)
await mkdir(target, { recursive: true })
await cp(source, target, { recursive: true })
