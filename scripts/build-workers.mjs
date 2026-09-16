import { build } from 'esbuild'
import { copyFile, mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
const root = fileURLToPath(new URL('../', import.meta.url))
const output = path.join(root, 'dist/server')
await mkdir(output, { recursive: true })
await copyFile(
  path.join(root, 'node_modules/@jitl/quickjs-wasmfile-release-sync/dist/emscripten-module.wasm'),
  path.join(output, 'quickjs.wasm'),
)
await build({
  entryPoints: [path.join(root, 'server/workers/index.ts')],
  outfile: path.join(output, 'index.js'),
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  conditions: ['browser'],
  external: ['node:*', './quickjs.wasm'],
  plugins: [{
    name: 'workers-rules-runtime',
    setup(builder) {
      builder.onResolve(
        { filter: /(^|\/)runner\.js$/ },
        args => ({ path: path.join(root, 'server/workers/runner.ts') }),
      )
      builder.onResolve({ filter: /quickjs\.wasm$/ }, () => ({ path: './quickjs.wasm', external: true }))
    },
  }],
})
