import sourcePolicy from '@cordisx/eslint-config'
import parser from '@typescript-eslint/parser'
export default [{ ignores: ['node_modules/**', 'dist/**', '.cache/**'] }, {
  files: ['**/*.{ts,tsx,mjs}'],
  ...sourcePolicy,
  languageOptions: { parser },
}]
