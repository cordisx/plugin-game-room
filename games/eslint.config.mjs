import policy from '@cordisx/eslint-config'
export default [
  { ignores: ['node_modules/**', 'dist/**'] },
  {
    ...policy,
    files: ['**/*.js', '**/*.mjs'],
    rules: {
      ...policy.rules,
      'no-unreachable': 'error',
      'no-dupe-keys': 'error',
      'valid-typeof': 'error',
    },
  },
]
