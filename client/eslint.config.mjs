import sourcePolicy from '@cordisx/eslint-config'
import parser from '@typescript-eslint/parser'
export default [{ ignores: ['node_modules/**', 'dist/**'] }, {
  files: ['**/*.{ts,tsx,mjs}'],
  ...sourcePolicy,
  languageOptions: { parser },
}]
