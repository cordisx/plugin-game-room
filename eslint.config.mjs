import sourcePolicy from '@cordisx/eslint-config'
import tsParser from '@typescript-eslint/parser'
export default [
  { ignores: ['node_modules/**', 'dist/**'] },
  { ...sourcePolicy, files: ['**/*.{js,mjs,cjs,ts,tsx,mts}'], languageOptions: { parser: tsParser } },
]
