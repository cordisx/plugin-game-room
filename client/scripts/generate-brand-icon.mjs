import { readFileSync, writeFileSync } from 'node:fs'

const data = readFileSync(new URL('../assets/icon.png', import.meta.url)).toString('base64')
writeFileSync(
  new URL('../src/brand-icon.ts', import.meta.url),
  `// Generated from assets/icon.png by scripts/generate-brand-icon.mjs.\n`
    + `import type { CordisXPluginBrandIcon } from 'cordisx/contracts'\n\n`
    + `export const icon = {\n  mediaType: 'image/png',\n  data:\n    '${data}',\n} as const satisfies CordisXPluginBrandIcon\n`,
)
