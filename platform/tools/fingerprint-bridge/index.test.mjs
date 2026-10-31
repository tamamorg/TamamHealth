import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createServer, loadAdapter } from './index.mjs';

let server;
let baseUrl;
let port;

before(async () => {
  const adapter = await loadAdapter('mock');
  server = createServer(adapter);
  await new Promise((resolve, reject) => {
    const onError = error => reject(error);
    server.once('error', onError);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', onError);
      resolve();
    });
  });
  port = server.address().port;
  baseUrl = `http://127.0.0.1:${port}`;
});

after(() => new Promise((resolve, reject) => {
  if (!server?.listening) return resolve();
  server.close(error => error ? reject(error) : resolve());
}));

async function post(path, body, headers = {}) {
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

/** Raw request so we can spoof the Host header (fetch forbids overriding it). */
function rawRequest(path, { method = 'GET', headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path, method, headers }, res => {
      let data = '';
      res.on('data', c => (data += c));
      res.on('end', () => resolve({ status: res.statusCode, body: data ? JSON.parse(data) : null }));
    });
    req.on('error', reject);
    req.end();
  });
}

test('GET /health reports driver and scanner state', async () => {
  const res = await fetch(`${baseUrl}/health`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.driver, 'mock');
  assert.equal(body.templateFormat, 'MOCK');
  assert.equal(body.scannerConnected, true);
});

test('POST /capture returns a template with quality and format', async () => {
  const { status, body } = await post('/capture', { finger: 'right_index' });
  assert.equal(status, 200);
  assert.ok(typeof body.template === 'string' && body.template.length > 0);
  assert.ok(body.quality > 0 && body.quality <= 100);
  assert.equal(body.finger, 'right_index');
  assert.equal(body.format, 'MOCK');
  assert.equal(body.driver, 'mock');
});

test('enroll + identify round trip: same simulateId matches at 100', async () => {
  const enrolled = await post('/capture', { simulateId: 'pat-abc123', finger: 'right_index' });
  const probe = await post('/capture', { simulateId: 'pat-abc123' });
  const other = await post('/capture', { simulateId: 'pat-zzz999' });

  const { status, body } = await post('/match', {
    probe: probe.body.template,
    candidates: [
      { id: 'tpl-1', template: enrolled.body.template },
      { id: 'tpl-2', template: other.body.template },
    ],
  });
  assert.equal(status, 200);
  assert.equal(body.matches.length, 1);
  assert.deepEqual(body.matches[0], { id: 'tpl-1', score: 100 });
});

test('POST /match returns empty list when nothing clears the threshold', async () => {
  const probe = await post('/capture', { simulateId: 'pat-nobody' });
  const candidate = await post('/capture', { simulateId: 'pat-someone' });
  const { body } = await post('/match', {
    probe: probe.body.template,
    candidates: [{ id: 'tpl-1', template: candidate.body.template }],
  });
  assert.deepEqual(body.matches, []);
});

test('POST /match validates payload', async () => {
  const missingProbe = await post('/match', { candidates: [] });
  assert.equal(missingProbe.status, 400);

  const badCandidates = await post('/match', { probe: 'abc', candidates: 'nope' });
  assert.equal(badCandidates.status, 400);
});

test('unknown route returns 404', async () => {
  const res = await fetch(`${baseUrl}/nope`);
  assert.equal(res.status, 404);
});

test('CORS preflight is answered', async () => {
  const res = await fetch(`${baseUrl}/capture`, { method: 'OPTIONS' });
  assert.equal(res.status, 204);
  assert.ok(res.headers.get('access-control-allow-origin'));
});

test('rejects a non-loopback Host header (DNS rebinding defence)', async () => {
  const res = await rawRequest('/health', { headers: { Host: 'evil.example.com' } });
  assert.equal(res.status, 403);
  assert.match(res.body.error, /host/i);
});

test('accepts a loopback Host header', async () => {
  const res = await rawRequest('/health', { headers: { Host: `localhost:${port}` } });
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
});

test('rejects a disallowed Origin before any scan side-effect', async () => {
  const res = await post('/capture', { finger: 'right_index' }, { Origin: 'http://attacker.example' });
  assert.equal(res.status, 403);
  assert.match(res.body.error, /origin/i);
});

test('allows the configured app Origin', async () => {
  const res = await post('/capture', { finger: 'right_index' }, { Origin: 'http://localhost:3000' });
  assert.equal(res.status, 200);
  assert.equal(res.body.format, 'MOCK');
});

test('enforces the shared-secret token when configured', async () => {
  process.env.FINGERPRINT_BRIDGE_TOKEN = 's3cret';
  try {
    const missing = await post('/capture', { finger: 'right_index' });
    assert.equal(missing.status, 401);

    const wrong = await post('/capture', { finger: 'right_index' }, { 'X-Bridge-Token': 'nope' });
    assert.equal(wrong.status, 401);

    const ok = await post('/capture', { finger: 'right_index' }, { 'X-Bridge-Token': 's3cret' });
    assert.equal(ok.status, 200);
  } finally {
    delete process.env.FINGERPRINT_BRIDGE_TOKEN;
  }
});

test('clamps a zero/negative threshold so it cannot match everyone', async () => {
  const probe = await post('/capture', { simulateId: 'pat-a' });
  const other = await post('/capture', { simulateId: 'pat-b' });
  const { body } = await post('/match', {
    probe: probe.body.template,
    candidates: [{ id: 'tpl-1', template: other.body.template }],
    threshold: 0,
  });
  // Mock scores a non-match at 0; with clamping (min 1) it must NOT be returned.
  assert.deepEqual(body.matches, []);
});
