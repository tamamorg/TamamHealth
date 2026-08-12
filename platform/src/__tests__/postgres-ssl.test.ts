import { postgresSslOptions } from '@/lib/db/postgres-ssl';

describe('postgresSslOptions', () => {
  test('uses strict system trust in production', () => {
    expect(postgresSslOptions({ NODE_ENV: 'production' })).toEqual({ rejectUnauthorized: true });
  });

  test('decodes a managed database CA', () => {
    const pem = '-----BEGIN CERTIFICATE-----\ntest\n-----END CERTIFICATE-----\n';
    expect(postgresSslOptions({
      NODE_ENV: 'production',
      DATABASE_CA_CERT_BASE64: Buffer.from(pem).toString('base64'),
    })).toEqual({ rejectUnauthorized: true, ca: pem });
  });

  test('rejects a malformed CA', () => {
    expect(() => postgresSslOptions({
      NODE_ENV: 'production',
      DATABASE_CA_CERT_BASE64: Buffer.from('not a certificate').toString('base64'),
    })).toThrow('does not decode to a PEM certificate');
  });
});
