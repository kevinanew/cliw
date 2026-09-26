module.exports = {
  testEnvironment: 'node',
  testMatch: [
    '<rootDir>/upgrader/typescript/**/*.test.mjs',
    '<rootDir>/upgrader/typescript/**/*.test.mts',
  ],
  transform: { '\\.mts$': '<rootDir>/jest.ts-transform.cjs' },
  setupFilesAfterEnv: ['<rootDir>/jest.setup.mjs'],
};
