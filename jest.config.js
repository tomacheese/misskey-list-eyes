/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['<rootDir>/src/**/*.test.ts'],
  moduleNameMapper: {
    '^puppeteer-core$': '<rootDir>/jest.mocks/puppeteer-core.ts',
  },
}
