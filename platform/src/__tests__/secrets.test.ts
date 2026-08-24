import { assertDopplerEnv } from '@/lib/secrets';

const originalEnv = process.env;

afterEach(() => {
  process.env = originalEnv;
  jest.restoreAllMocks();
});

test('Doppler mode fails before boot when payment verification values were not injected', () => {
  process.env = { NODE_ENV: 'test', DOPPLER_TOKEN: 'dp.st.test', JWT_SECRET: 'jwt-present' };
  jest.spyOn(console, 'error').mockImplementation(() => {});

  expect(() => assertDopplerEnv()).toThrow(/AIRTEL_WEBHOOK_SECRET/);
});

test('Doppler mode accepts the complete always-required secret set', () => {
  process.env = {
    NODE_ENV: 'test',
    DOPPLER_TOKEN: 'dp.st.test',
    JWT_SECRET: 'jwt-present',
    AIRTEL_WEBHOOK_SECRET: 'airtel-present',
    AIRTEL_WEBHOOK_GATEWAY_VERIFIED: 'true',
    MPESA_WEBHOOK_SECRET: 'mpesa-present',
    MPESA_WEBHOOK_GATEWAY_VERIFIED: 'true',
  };

  expect(() => assertDopplerEnv()).not.toThrow();
});
