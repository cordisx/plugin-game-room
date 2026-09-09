import sourcePolicy from '@cordisx/eslint-config';
import tseslint from 'typescript-eslint';
export default [{ ignores: ['node_modules/**'] }, {
  files: ['**/*.ts', '**/*.mjs'],
  languageOptions: { parser: tseslint.parser },
  ...sourcePolicy,
}];
