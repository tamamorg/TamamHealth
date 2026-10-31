/**
 * What `stripPHI` / `stripPHITransaction` take out of an event before it
 * leaves the server: credentials in headers, query strings, identifying text
 * in exception messages, local variables, user contact details, and the URLs
 * on a performance transaction's spans.
 */
import type { Event } from '@sentry/core';
import { scrubText, stripPHI, stripPHITransaction, stripQuery } from '@/lib/observability';

describe('headers and URLs', () => {
  it('redacts authorization, CSRF and token-like headers, not ordinary ones', () => {
    const event: Event = {
      request: {
        headers: {
          Authorization: 'Bearer abc.def.ghi', 'X-CSRF-Token': 'csrf', 'x-api-key': 'k', 'x-session-id': 's',
          'user-agent': 'jest', Referer: 'https://app.example/patients?patientId=pat-1',
        },
      },
    };
    const headers = stripPHI(event).request!.headers as Record<string, string>;
    expect(headers).toMatchObject({
      Authorization: '[redacted]', 'X-CSRF-Token': '[redacted]', 'x-api-key': '[redacted]', 'x-session-id': '[redacted]',
      'user-agent': 'jest', Referer: 'https://app.example/patients',
    });
  });

  it('drops the query string from the request URL and the transaction name', () => {
    const event: Event = {
      transaction: 'GET /api/restricted-mental-health-notes?breakGlassReason=patient+is+Ayen+Deng',
      request: { url: 'https://app.example/api/restricted-mental-health-notes?patientId=p1&breakGlassReason=urgent', query_string: 'patientId=p1' },
    };
    const out = stripPHI(event);
    expect(out.request!.url).toBe('https://app.example/api/restricted-mental-health-notes');
    expect(out.request!.query_string).toBe('[redacted]');
    expect(out.transaction).toBe('GET /api/restricted-mental-health-notes');
    expect(JSON.stringify(out)).not.toMatch(/breakGlassReason|Ayen/);
  });

  it('cleans breadcrumb URLs and text', () => {
    const out = stripPHI({
      breadcrumbs: [{ category: 'fetch', message: 'GET /api/patients?q=Ayen%20Deng', data: { url: '/api/patients?q=Ayen', status_code: 200 } }],
    } as Event);
    expect(out.breadcrumbs![0].data).toMatchObject({ url: '/api/patients', status_code: 200 });
    expect(out.breadcrumbs![0].message).toBe('GET /api/patients');
  });
});

describe('exception text', () => {
  it('scrubs the recognisable shapes and keeps the rest', () => {
    expect(scrubText('Patient lookup failed for +211912345678 (ayen@example.org)')).toBe('Patient lookup failed for [redacted] ([redacted])');
    expect(scrubText('bad token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyIn0.abcdefghijk')).toBe('bad token [redacted]');
    expect(scrubText('Authorization: Bearer abcDEF123.456')).toBe('Authorization: [redacted]');
    expect(scrubText('fetch https://couch/db/_find?token=zzz failed')).toBe('fetch https://couch/db/_find failed');
    expect(scrubText('Database tamamhealth_patients--org-a is unavailable')).toBe('Database tamamhealth_patients--org-a is unavailable');
    expect(scrubText('x'.repeat(500)).length).toBeLessThan(400);
  });

  it('applies it to exceptions, messages and log entries, and removes frame variables', () => {
    const event = {
      message: 'call from +211912345678',
      logentry: { message: 'user %s', params: ['Ayen Deng'] },
      exception: { values: [{ type: 'Error', value: 'No record for 0912345678', stacktrace: { frames: [{ function: 'f', vars: { patientName: 'Ayen' } }] } }] },
      user: { id: 'u1', email: 'a@b.org', ip_address: '1.2.3.4', username: 'ayen' },
    } as unknown as Event;
    const out = stripPHI(event);
    expect(out.message).toBe('call from [redacted]');
    expect(out.logentry).toEqual({ message: 'user %s' });
    expect(out.exception!.values![0].value).toBe('No record for [redacted]');
    expect(out.exception!.values![0].stacktrace!.frames![0]).not.toHaveProperty('vars');
    expect(out.user).toEqual({ id: 'u1' });
  });
});

describe('stripPHITransaction', () => {
  it('cleans the request and every span URL', () => {
    const tx = {
      type: 'transaction',
      transaction: 'GET /patients?q=Ayen',
      request: { url: 'https://app.example/patients?q=Ayen', headers: { cookie: 'tamamhealth-token=abc' } },
      contexts: { trace: { data: { 'http.query': '?q=Ayen', 'http.url': 'https://app.example/patients?q=Ayen' } } },
      spans: [
        { description: 'GET https://couch/db/_find?token=zzz', data: { 'http.url': 'https://couch/db/_find?token=zzz', 'http.query': '?token=zzz' } },
      ],
    } as unknown as Event;
    const out = stripPHITransaction(tx) as unknown as { spans: Array<{ description: string; data: Record<string, string> }> } & Event;
    expect(JSON.stringify(out)).not.toMatch(/Ayen|token=zzz|tamamhealth-token/);
    expect(out.spans[0].description).toBe('GET https://couch/db/_find');
    expect(out.spans[0].data['http.query']).toBe('[redacted]');
  });
});

describe('stripQuery', () => {
  it('removes the query and fragment', () => {
    expect(stripQuery('/a/b?x=1#f')).toBe('/a/b');
    expect(stripQuery('/a/b')).toBe('/a/b');
  });
});
