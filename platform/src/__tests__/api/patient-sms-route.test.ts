/** @jest-environment node
 *
 * POST /api/patient-sms — the one place a device can ask the SMS gateway to
 * text a patient.
 *
 * The properties that matter:
 *   - the number comes from the patient's record on the server, never from
 *     the request (or any signed-in account could text arbitrary numbers);
 *   - a deployment with no gateway says so, instead of the no-op provider's
 *     "ok" being read as a delivered text;
 *   - a patient the server has not received yet is a RETRY, not a failure;
 *   - a retried message id is not sent twice — and an id means nothing when
 *     replayed against another patient or by another account;
 *   - the record's number must still be the one the sender confirmed;
 *   - an out-of-scope patient is answered exactly like a missing one;
 *   - what the gateway says about a failure never reaches the device verbatim.
 */
jest.mock('@/lib/audit/with-audit', () => ({
  AUDIT_ACTION_HEADER: 'x-audit-action',
  withAuditLog: (handler: (...args: unknown[]) => Promise<Response>) => handler,
}));

const actor: { sub: string; username: string; name: string; role: string; orgId?: string; hospitalId?: string } = {
  sub: 'user-dr-wani', username: 'dr.wani', name: 'Dr. James Wani',
  role: 'doctor', orgId: 'org-moh-ss', hospitalId: 'hosp-001',
};
let signedIn = true;
jest.mock('@/modules/identity/core/api-auth', () => ({
  getAuthPayload: jest.fn(async () => (signedIn ? actor : null)),
  unauthorized: jest.fn(() => Response.json({ error: 'unauthorized' }, { status: 401 })),
  forbidden: jest.fn((error = 'forbidden') => Response.json({ error }, { status: 403 })),
  hasRole: jest.fn((auth: { role: string }, roles: string[]) => roles.includes(auth.role)),
  serverError: jest.fn(() => Response.json({ error: 'Internal server error' }, { status: 500 })),
  logApiError: jest.fn(),
}));

let standalone = false;
jest.mock('@/modules/identity/core/server-users', () => ({
  isStandaloneDemo: () => standalone,
}));

type Patient = { _id: string; phone?: string; orgId?: string; hospitalId?: string; registrationHospital?: string } | null;
let patient: Patient = null;
let lookupThrows = false;
jest.mock('@/lib/services/patient-service', () => ({
  getPatientById: jest.fn(async () => {
    if (lookupThrows) throw new Error('storage down');
    return patient;
  }),
}));

let inScope = true;
jest.mock('@/lib/services/data-scope', () => ({
  buildScopeFromAuth: jest.fn(() => ({})),
  filterByScope: jest.fn((docs: unknown[]) => (inScope ? docs : [])),
}));

let provider = 'africastalking';
const sendSms = jest.fn(async (_input: { to: string; body: string }) => (
  { ok: true, providerId: provider, providerMessageId: 'ATXid_1' } as { ok: boolean; providerId: string; providerMessageId?: string; error?: string }
));
jest.mock('@/lib/sms', () => ({
  getSmsProvider: () => ({ name: provider }),
  sendSms: (input: { to: string; body: string }) => sendSms(input),
}));

let allowed = true;
/** Rate-limit keys (by prefix) that are out of allowance. */
let exhausted: string[] = [];
const rateLimit = jest.fn(async ({ key }: { key: string; limit: number; windowMs: number }) => {
  const ok = allowed && !exhausted.some(prefix => key.startsWith(prefix));
  return { allowed: ok, resetAt: Date.now() + 60_000, remaining: ok ? 10 : 0 };
});
jest.mock('@/lib/rate-limit', () => ({
  rateLimit: (input: { key: string; limit: number; windowMs: number }) => rateLimit(input),
  // No shared store in these tests: the dispatch ledger keeps to this process.
  getUpstashConfig: () => null,
  upstashPipeline: jest.fn(),
}));

let encryptionOn = false;
jest.mock('@/lib/field-encryption', () => ({
  isEncryptionEnabled: () => encryptionOn,
  encryptField: (plaintext: string) => `enc:v1:${Buffer.from(plaintext).toString('base64')}`,
}));

const logAuditSafe = jest.fn(async (..._args: unknown[]) => undefined);
jest.mock('@/lib/services/audit-service', () => ({
  logAuditSafe: (...args: unknown[]) => logAuditSafe(...args),
}));

import { NextRequest } from 'next/server';
import { POST } from '@/app/api/patient-sms/route';
import { resetDispatchLedgerForTest } from '@/lib/sms/dispatch-ledger';

/** Every well-formed request carries the sender's consent confirmation unless a test withholds it. */
function post(body: unknown) {
  return POST(new NextRequest('http://localhost/api/patient-sms', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify({ consentConfirmed: true, ...(body as object) }),
  }));
}

/** A well-formed message document id, as `message-service` mints them. */
const msg = (n: number) => `msg-00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

beforeEach(() => {
  signedIn = true;
  actor.role = 'doctor';
  actor.sub = 'user-dr-wani';
  standalone = false;
  patient = { _id: 'pat-1', phone: '0912345145', orgId: 'org-moh-ss', hospitalId: 'hosp-001' };
  lookupThrows = false;
  inScope = true;
  provider = 'africastalking';
  allowed = true;
  exhausted = [];
  encryptionOn = false;
  rateLimit.mockClear();
  delete process.env.PATIENT_SMS_COUNTRY_CODES;
  sendSms.mockClear();
  logAuditSafe.mockClear();
  resetDispatchLedgerForTest();
});

describe('POST /api/patient-sms', () => {
  it('sends to the number on the patient record, ignoring any number in the request', async () => {
    const res = await post({ patientId: 'pat-1', text: 'Your prescription', phone: '+15550001111', messageId: msg(1), purpose: 'prescription' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      state: 'sent', provider: 'africastalking', providerMessageId: 'ATXid_1', to: '091•••••145',
    });
    expect(sendSms).toHaveBeenCalledTimes(1);
    expect(sendSms.mock.calls[0][0]).toEqual({ to: '0912345145', body: 'Your prescription' });
  });

  it('audits what was sent by digest — never the body or the number', async () => {
    await post({ patientId: 'pat-1', text: 'Take one tablet twice daily', messageId: msg(2), purpose: 'prescription' });
    const detail = String(logAuditSafe.mock.calls[0][3]);
    expect(logAuditSafe.mock.calls[0][0]).toBe('PATIENT_TEXT_DISPATCH');
    expect(detail).toContain('prescription text for patient pat-1');
    expect(detail).toContain(`message ${msg(2)}`);
    expect(detail).toContain('27 chars');
    expect(detail).toMatch(/sha256 [0-9a-f]{16}/);
    expect(detail).not.toMatch(/tablet|0912345145/);
  });

  it('records an unknown purpose as a plain message rather than echoing it into the audit', async () => {
    await post({ patientId: 'pat-1', text: 'x', messageId: msg(3), purpose: 'pay your bill to 0911 000 000' });
    expect(String(logAuditSafe.mock.calls[0][3])).toMatch(/^message text for patient pat-1/);
  });

  it('refuses a signed-out caller and a role that may not message patients', async () => {
    signedIn = false;
    expect((await post({ patientId: 'pat-1', text: 'x', messageId: msg(4) })).status).toBe(401);
    signedIn = true;
    actor.role = 'government';
    expect((await post({ patientId: 'pat-1', text: 'x', messageId: msg(4) })).status).toBe(403);
    expect(sendSms).not.toHaveBeenCalled();
  });

  it('answers an out-of-scope patient exactly like one that does not exist', async () => {
    inScope = false;
    const outOfScope = await post({ patientId: 'pat-1', text: 'x', messageId: msg(5) });
    inScope = true;
    patient = null;
    const missing = await post({ patientId: 'pat-nobody', text: 'x', messageId: msg(6) });
    expect(outOfScope.status).toBe(409);
    expect(missing.status).toBe(409);
    expect(await outOfScope.json()).toEqual(await missing.json());
    expect(sendSms).not.toHaveBeenCalled();
  });

  it('rejects an empty or oversized text, a malformed body, and a text with no message document', async () => {
    expect((await post({ patientId: 'pat-1', text: '   ', messageId: msg(7) })).status).toBe(400);
    expect((await post({ patientId: '', text: 'x', messageId: msg(7) })).status).toBe(400);
    expect((await post({ patientId: 'pat-1', text: 'a'.repeat(1531), messageId: msg(7) })).status).toBe(400);
    expect((await post('{not json')).status).toBe(400);
    expect((await post({ patientId: 'pat-1', text: 'x' })).status).toBe(400);
    expect((await post({ patientId: 'pat-1', text: 'x', messageId: 'anything' })).status).toBe(400);
    expect(sendSms).not.toHaveBeenCalled();
  });

  it('reports not_connected when no gateway is configured, and sends nothing', async () => {
    provider = 'noop';
    const res = await post({ patientId: 'pat-1', text: 'Your prescription', messageId: msg(8) });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ state: 'not_connected', provider: 'noop' });
    expect(sendSms).not.toHaveBeenCalled();
  });

  it('reports not_connected when a provider is selected but has no credentials', async () => {
    sendSms.mockResolvedValueOnce({ ok: false, providerId: 'africastalking', error: 'credentials_missing' });
    const res = await post({ patientId: 'pat-1', text: 'x', messageId: msg(9) });
    expect(await res.json()).toEqual({ state: 'not_connected', provider: 'africastalking' });
  });

  it('answers not_connected on a standalone demo, which holds no patient records', async () => {
    standalone = true;
    provider = 'noop';
    patient = null;
    const res = await post({ patientId: 'pat-local-only', text: 'Your prescription', messageId: msg(10) });
    expect(await res.json()).toMatchObject({ state: 'not_connected' });
  });

  it('asks the device to retry when the patient record has not reached the server', async () => {
    patient = null;
    const res = await post({ patientId: 'pat-new', text: 'x', messageId: msg(11) });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'patient_not_synced' });
    expect(sendSms).not.toHaveBeenCalled();
  });

  it('treats a storage outage as retryable, not as a missing patient', async () => {
    lookupThrows = true;
    expect((await post({ patientId: 'pat-1', text: 'x', messageId: msg(12) })).status).toBe(503);
  });

  it('refuses to send when the record holds no phone number', async () => {
    patient = { _id: 'pat-1', phone: '' };
    const res = await post({ patientId: 'pat-1', text: 'x', messageId: msg(13) });
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: 'no_phone' });
  });

  describe('the number the sender confirmed', () => {
    it('sends when the record still ends in the digits the sender saw, whatever the formatting', async () => {
      patient = { _id: 'pat-1', phone: '+211 912 345 145' };
      const res = await post({ patientId: 'pat-1', text: 'x', messageId: msg(14), phoneTail: '345145' });
      expect(await res.json()).toMatchObject({ state: 'sent' });
    });

    it('sends nothing when the record has a different number', async () => {
      // Reception replaced a lost or unsafe phone; this device has not caught up.
      patient = { _id: 'pat-1', phone: '0922000777' };
      const res = await post({ patientId: 'pat-1', text: 'Your prescription', messageId: msg(15), phoneTail: '345145' });
      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ error: 'phone_changed' });
      expect(sendSms).not.toHaveBeenCalled();
    });
  });

  describe('gateway failures', () => {
    it('passes back a bare gateway status as a fixed code', async () => {
      sendSms.mockResolvedValueOnce({ ok: false, providerId: 'africastalking', error: 'InvalidPhoneNumber' });
      const res = await post({ patientId: 'pat-1', text: 'x', messageId: msg(16) });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ state: 'failed', provider: 'africastalking', error: 'gateway_rejected: InvalidPhoneNumber' });
    });

    it('never forwards free text from the gateway, which can quote the number', async () => {
      sendSms.mockResolvedValueOnce({ ok: false, providerId: 'twilio', error: "The 'To' number +211912345145 is not a valid phone number." });
      const json = await (await post({ patientId: 'pat-1', text: 'x', messageId: msg(17) })).json();
      expect(json).toEqual({ state: 'failed', provider: 'twilio', error: 'gateway_rejected' });
      expect(JSON.stringify(json)).not.toContain('211912345145');
    });

    it.each(['network_error: fetch failed', 'http_503: upstream', 'http_429'])('asks for a retry on a transient failure (%s)', async (error) => {
      sendSms.mockResolvedValueOnce({ ok: false, providerId: 'africastalking', error });
      const res = await post({ patientId: 'pat-1', text: 'x', messageId: msg(18) });
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({ error: 'gateway_unavailable' });
    });
  });

  describe('retries', () => {
    it('does not text the patient twice when a message id is retried', async () => {
      const first = await (await post({ patientId: 'pat-1', text: 'x', messageId: msg(19) })).json();
      const again = await (await post({ patientId: 'pat-1', text: 'x', messageId: msg(19) })).json();
      expect(first.state).toBe('sent');
      expect(again).toMatchObject({ state: 'sent', duplicate: true });
      expect(sendSms).toHaveBeenCalledTimes(1);
    });

    it('retries a message whose earlier attempt the gateway rejected', async () => {
      sendSms.mockResolvedValueOnce({ ok: false, providerId: 'africastalking', error: 'InsufficientBalance' });
      await post({ patientId: 'pat-1', text: 'x', messageId: msg(20) });
      const again = await (await post({ patientId: 'pat-1', text: 'x', messageId: msg(20) })).json();
      expect(again).toMatchObject({ state: 'sent' });
      expect(again.duplicate).toBeUndefined();
      expect(sendSms).toHaveBeenCalledTimes(2);
    });

    it('does not treat a sent id as sent for another patient or another sender', async () => {
      await post({ patientId: 'pat-1', text: 'x', messageId: msg(21) });
      // Same id, different patient: a real dispatch, not a replayed "sent".
      patient = { _id: 'pat-2', phone: '0915000222' };
      const otherPatient = await (await post({ patientId: 'pat-2', text: 'x', messageId: msg(21) })).json();
      expect(otherPatient.duplicate).toBeUndefined();
      // Same id and patient, different account.
      patient = { _id: 'pat-1', phone: '0912345145' };
      actor.sub = 'user-someone-else';
      const otherSender = await (await post({ patientId: 'pat-1', text: 'x', messageId: msg(21) })).json();
      expect(otherSender.duplicate).toBeUndefined();
      expect(sendSms).toHaveBeenCalledTimes(3);
    });

    it('lets only one of two racing requests reach the gateway', async () => {
      let release: (value: { ok: boolean; providerId: string }) => void = () => {};
      sendSms.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
      const first = post({ patientId: 'pat-1', text: 'x', messageId: msg(22) });
      // Let the first request reach the gateway call before the second arrives.
      await new Promise(resolve => setTimeout(resolve, 20));
      const second = await post({ patientId: 'pat-1', text: 'x', messageId: msg(22) });
      expect(second.status).toBe(409);
      expect(await second.json()).toEqual({ error: 'in_flight' });
      release({ ok: true, providerId: 'africastalking' });
      expect((await (await first).json()).state).toBe('sent');
      expect(sendSms).toHaveBeenCalledTimes(1);
    });
  });

  it('rate limits a runaway sender', async () => {
    allowed = false;
    const res = await post({ patientId: 'pat-1', text: 'x', messageId: msg(23) });
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBeTruthy();
    expect(sendSms).not.toHaveBeenCalled();
  });

  describe('what was said', () => {
    const bodyEntries = () => logAuditSafe.mock.calls.filter(call => call[0] === 'PATIENT_TEXT_BODY');

    it('keeps the text, encrypted, where PHI encryption is on — so a text with no chart record can still be read back', async () => {
      encryptionOn = true;
      await post({ patientId: 'pat-1', text: 'Pay 5000 SSP to this number', messageId: msg(70) });
      expect(bodyEntries()).toHaveLength(1);
      const details = String(bodyEntries()[0][3]);
      expect(details).toContain(`message ${msg(70)} to patient pat-1`);
      expect(details).not.toContain('Pay 5000 SSP');
      expect(Buffer.from(details.split('enc:v1:')[1], 'base64').toString()).toBe('Pay 5000 SSP to this number');
    });

    it('stores no copy at all without encryption — never a plaintext one', async () => {
      await post({ patientId: 'pat-1', text: 'Your prescription', messageId: msg(71) });
      expect(bodyEntries()).toHaveLength(0);
      expect(JSON.stringify(logAuditSafe.mock.calls)).not.toContain('Your prescription');
    });

    it('keeps nothing for a text that did not go', async () => {
      encryptionOn = true;
      sendSms.mockResolvedValueOnce({ ok: false, providerId: 'africastalking', error: 'InvalidPhoneNumber' });
      await post({ patientId: 'pat-1', text: 'Your prescription', messageId: msg(72) });
      expect(bodyEntries()).toHaveLength(0);
    });
  });

  describe('consent', () => {
    it('refuses a text the sender did not confirm consent for, whichever screen sent it', async () => {
      for (const consentConfirmed of [undefined, false, 'true', 1]) {
        const res = await post({ patientId: 'pat-1', text: 'x', messageId: msg(30), consentConfirmed });
        expect(res.status).toBe(422);
        expect(await res.json()).toEqual({ error: 'consent_required' });
      }
      expect(sendSms).not.toHaveBeenCalled();
      // Refused before it costs the sender any of their allowance.
      expect(rateLimit).not.toHaveBeenCalled();
    });
  });

  describe('who may be texted', () => {
    it('refuses a number outside the countries the facility texts', async () => {
      // Any role that can edit a chart could otherwise aim the gateway anywhere.
      for (const phone of ['+447700900123', '+15550001111', '+8613800138000', '12345']) {
        patient = { _id: 'pat-1', phone, orgId: 'org-moh-ss', hospitalId: 'hosp-001' };
        const res = await post({ patientId: 'pat-1', text: 'x', messageId: msg(31) });
        expect(res.status).toBe(422);
        expect(await res.json()).toEqual({ error: 'destination_not_allowed' });
      }
      expect(sendSms).not.toHaveBeenCalled();
    });

    it('sends to South Sudan and its neighbours by default', async () => {
      const phones = ['0912345145', '+211912345145', '+256701234567', '+254712345678', '+249912345678'];
      for (const [i, phone] of phones.entries()) {
        patient = { _id: 'pat-1', phone, orgId: 'org-moh-ss', hospitalId: 'hosp-001' };
        expect((await post({ patientId: 'pat-1', text: 'x', messageId: msg(40 + i) })).status).toBe(200);
      }
      expect(sendSms).toHaveBeenCalledTimes(phones.length);
    });

    it('follows PATIENT_SMS_COUNTRY_CODES when the deployment sets it', async () => {
      process.env.PATIENT_SMS_COUNTRY_CODES = '211';
      patient = { _id: 'pat-1', phone: '+256701234567', orgId: 'org-moh-ss', hospitalId: 'hosp-001' };
      expect((await post({ patientId: 'pat-1', text: 'x', messageId: msg(50) })).status).toBe(422);
      patient = { _id: 'pat-1', phone: '0912345145', orgId: 'org-moh-ss', hospitalId: 'hosp-001' };
      expect((await post({ patientId: 'pat-1', text: 'x', messageId: msg(51) })).status).toBe(200);
    });
  });

  describe('volume', () => {
    it('caps what one patient can be sent, whoever is sending', async () => {
      exhausted = ['patient-sms:patient:pat-1'];
      const res = await post({ patientId: 'pat-1', text: 'x', messageId: msg(60) });
      expect(res.status).toBe(429);
      expect(sendSms).not.toHaveBeenCalled();
    });

    it('caps what one organisation can send in a day', async () => {
      exhausted = ['patient-sms:org:org-moh-ss'];
      const res = await post({ patientId: 'pat-1', text: 'x', messageId: msg(61) });
      expect(res.status).toBe(429);
      expect(sendSms).not.toHaveBeenCalled();
    });

    it('counts each send against the sender, the patient and the organisation', async () => {
      await post({ patientId: 'pat-1', text: 'x', messageId: msg(62) });
      expect(rateLimit.mock.calls.map(call => call[0].key)).toEqual([
        'patient-sms:user-dr-wani', 'patient-sms:patient:pat-1', 'patient-sms:org:org-moh-ss',
      ]);
    });
  });
});
