module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.test.ts'],
  transform: {
    '^.+\\.(ts|tsx|js)$': ['ts-jest', {
      tsconfig: {
        strict: true,
        target: 'es2022',
        module: 'commonjs',
        allowJs: true,
      },
    }],
  },
  transformIgnorePatterns: [
    '/node_modules/(?!(three)/)',
  ],
};
