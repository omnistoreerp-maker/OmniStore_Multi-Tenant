module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*.test.js'],
  testTimeout: 30000,
  collectCoverageFrom: [
    '**/*.js',
    '!tests/**',
    '!node_modules/**',
    '!coverage/**',
    '!jest.config.js'
  ],
  coverageDirectory: '<rootDir>/coverage'
};
