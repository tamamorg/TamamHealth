/** @jest-environment node */
import { createServer, type Server, type Socket } from 'node:net';
import { sendEmail, wasDelivered, resetEmailProviderForTest } from '@/lib/email';
import { sendWelcomeEmail } from '@/modules/identity/email/user-welcome';

const originalEnv = { ...process.env };
let server: Server;
const sockets = new Set<Socket>();
let received = '';
let rejectRecipient = false;

beforeEach(async () => {
  received = '';
  rejectRecipient = false;
  server = createServer(socket => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.write('220 localhost test SMTP\r\n');
    let buffer = '';
    let inData = false;
    socket.on('data', chunk => {
      buffer += chunk.toString();
      while (buffer.includes('\r\n')) {
        const end = buffer.indexOf('\r\n');
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        if (inData) {
          if (line === '.') { inData = false; socket.write('250 queued-test\r\n'); }
          else received += line + '\n';
        } else if (/^(EHLO|HELO)/.test(line)) socket.write('250 localhost\r\n');
        else if (line.startsWith('RCPT') && rejectRecipient) socket.write('550 rejected\r\n');
        else if (line === 'DATA') { inData = true; socket.write('354 send data\r\n'); }
        else if (line === 'QUIT') socket.end('221 goodbye\r\n');
        else socket.write('250 OK\r\n');
      }
    });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No SMTP port');
  process.env.EMAIL_PROVIDER = 'smtp';
  process.env.SMTP_URL = `smtp://127.0.0.1:${address.port}`;
  process.env.FROM_EMAIL = 'sender@example.invalid';
  resetEmailProviderForTest();
});

afterEach(async () => {
  for (const socket of sockets) socket.destroy();
  await new Promise<void>(resolve => server.close(() => resolve()));
  process.env = { ...originalEnv };
  resetEmailProviderForTest();
});

test('the installed SMTP transport delivers the full invitation to a local test server', async () => {
  const result = await sendWelcomeEmail({ to: 'recipient@example.invalid', name: 'Synthetic Test', username: 'test-only', roleLabel: 'Nurse', inviteUrl: 'https://example.invalid/accept-invite?token=test-only', expiresInHours: 72 });
  expect(wasDelivered(result)).toBe(true);
  expect(result.providerMessageId).toBeTruthy();
  expect(received).toContain('Subject: Set up your TamamHealth account');
  const decoded = received.replace(/=\n/g, '').replace(/=([0-9A-F]{2})/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));
  expect(decoded).toContain('https://example.invalid/accept-invite?token=test-only');
});

test('rejected SMTP recipients are not reported as sent', async () => {
  rejectRecipient = true;
  expect(wasDelivered(await sendEmail({ to: 'recipient@example.invalid', subject: 'Test', body: 'Test' }))).toBe(false);
  expect(received).toBe('');
});

test('missing sender configuration fails before sending', async () => {
  delete process.env.FROM_EMAIL;
  expect(await sendEmail({ to: 'recipient@example.invalid', subject: 'Test', body: 'Test' })).toEqual(expect.objectContaining({ ok: false, error: 'FROM_EMAIL not configured' }));
  expect(received).toBe('');
});
