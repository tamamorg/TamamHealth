import type { Config } from 'jest';
import nextJest from 'next/jest.js';

const createJestConfig = nextJest({
  dir: './',
});

const config: Config = {
  testEnvironment: 'jsdom',
  setupFiles: ['<rootDir>/jest.setup.ts'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  testPathIgnorePatterns: ['<rootDir>/node_modules/', '<rootDir>/.next/', '<rootDir>/src/__tests__/helpers/'],
};

const buildConfig = async () => {
  const jestConfig = await createJestConfig(config as unknown as Parameters<typeof createJestConfig>[0])();
  jestConfig.transformIgnorePatterns = [
    '/node_modules/(?!(jose|uuid|pouchdb-adapter-memory)/).*\\.js$',
  ];
  // Only match files that explicitly end with .test.ts(x) — stops jest from
  // picking up test helpers like src/__tests__/helpers/test-db.ts.
  jestConfig.testMatch = ['<rootDir>/src/**/*.test.ts', '<rootDir>/src/**/*.test.tsx'];
  jestConfig.collectCoverageFrom = [
    'src/lib/services/**/*.ts',
    'src/lib/hooks/**/*.{ts,tsx}',
    'src/modules/**/*.{ts,tsx}',
    'src/lib/validation.ts',
    'src/lib/db-seed.ts',
    '!src/**/*.d.ts',
    '!src/modules/**/types.ts',
  ];
  return jestConfig;
};

export default buildConfig;
