import { assertDopplerEnv } from '@/lib/secrets';

const originalEnv = process.env;

afterEach(() => {
  process.env = originalEnv;
  jest.restoreAllMocks();
});

test('Doppler mode fails before boot when session signing was not injected', () => {
  process.env = { NODE_ENV: 'test', DOPPLER_TOKEN: 'dp.st.test' };
  jest.spyOn(console, 'error').mockImplementation(() => {});

  expect(() => assertDopplerEnv()).toThrow(/JWT_SECRET/);
});

test('Doppler mode does not require optional payment integrations', () => {
  process.env = {
    NODE_ENV: 'test',
    DOPPLER_TOKEN: 'dp.st.test',
    JWT_SECRET: 'jwt-present',
  };

  expect(() => assertDopplerEnv()).not.toThrow();
});
