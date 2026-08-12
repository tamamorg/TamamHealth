import {
  connectionStringForExplicitSsl,
  postgresSslOptions,
} from '@/lib/db/postgres-ssl';

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

describe('connectionStringForExplicitSsl', () => {
  const ssl = { rejectUnauthorized: true as const, ca: 'test-ca' };

  test('removes URL SSL parameters that would override the explicit CA', () => {
    const result = connectionStringForExplicitSsl(
      'postgresql://user:pass@example.com:25060/app?sslmode=verify-full&application_name=tamam',
      ssl,
    );
    const url = new URL(result);
    expect(url.searchParams.has('sslmode')).toBe(false);
    expect(url.searchParams.get('application_name')).toBe('tamam');
  });

  test('preserves the original URL when explicit SSL is disabled', () => {
    const input = 'postgresql://user:pass@localhost:5432/app?sslmode=disable';
    expect(connectionStringForExplicitSsl(input, undefined)).toBe(input);
  });
});
