import book000Config from '@book000/eslint-config'

export default [
  ...book000Config,
  {
    // vitest.config.ts is not covered by the build tsconfig.json (rootDir: src),
    // so typed linting uses tsconfig.eslint.json, which widens `include`.
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parserOptions: {
        project: ['tsconfig.eslint.json'],
      },
    },
  },
  {
    // Config files must call defineConfig() at the top level
    files: ['*.config.ts'],
    rules: { 'unicorn/no-top-level-side-effects': 'off' },
  },
]
