import book000Config from '@book000/eslint-config'

export default [
  ...book000Config,
  {
    // jest.mocks/**/*.ts はビルド対象の tsconfig.json（rootDir: src）に
    // 含まれないため、eslint 用に include を広げた tsconfig.eslint.json を
    // 型情報付き lint に使用する。
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parserOptions: {
        project: ['tsconfig.eslint.json'],
      },
    },
  },
]
