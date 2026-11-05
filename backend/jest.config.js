module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*.test.js'],
  testTimeout: 30000,
  // Tests control configuration exclusively via process.env. Loading the
  // developer's real backend/.env would re-inject values a test just cleared.
  moduleNameMapper: {
    '^dotenv$': '<rootDir>/tests/helpers/dotenvMock.js'
  },
  collectCoverageFrom: [
    '**/*.js',
    '!tests/**',
    '!node_modules/**',
    '!coverage/**',
    '!jest.config.js'
  ],
  coverageDirectory: '<rootDir>/coverage'
};
