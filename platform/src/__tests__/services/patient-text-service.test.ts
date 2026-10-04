/**
 * The device side of texting a patient: write the message first, then hand it
 * to the gateway route, and record which of four things happened. Before this
 * service a message saved with channel "SMS" was stamped "sent" and went
 * nowhere.
 */
jest.mock('uuid', () => {
  let n = 0;
  return { v4: () => `uuid-${++n}` };
});
jest.mock('@/lib/db', () => require('../helpers/test-db').createDBMock());

const apiFetch = jest.fn();
jest.mock('@/lib/api-fetch', () => ({ apiFetch: (...args: unknown[]) => apiFetch(...args) }));

jest.setTimeout(30000);

import { teardownTestDBs } from '../helpers/test-db';
import { messagesDB, prescriptionsDB } from '@/lib/db';
import {
  MAX_TEXT_ATTEMPTS, dispatchPatientText, flushQueuedPatientTexts, isTextRetryDue, resetTextOutboxForTest,
  sendPatientText,
} from '@/modules/communication/services/patient-text-service';
import type { MessageDoc, PrescriptionDoc } from '@/lib/db-types';
import type { DataScope } from '@/lib/services/data-scope';

const SENDER = { _id: 'user-dr-wani', name: 'Dr. James Wani', hospitalId: 'hosp-001', hospitalName: 'Wau State Hospital', orgId: 'org-1' };
const PATIENT = { _id: 'pat-1', name: 'Mary Akol', phone: '0912345145' };
const SCOPE = { orgId: 'org-1', hospitalId: 'hosp-001', role: 'super_admin', userId: 'user-dr-wani' } as unknown as DataScope;

function reply(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function setOnline(online: boolean) {
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: online });
}

async function stored(id: string): Promise<MessageDoc> {
  return await messagesDB().get(id) as MessageDoc;
}

beforeEach(() => {
  apiFetch.mockReset();
  setOnline(true);
  resetTextOutboxForTest();
});

afterEach(async () => {
  await teardownTestDBs();
});

describe('sendPatientText', () => {
  it('writes the message, posts it to the gateway route, and records a sent text', async () => {
    apiFetch.mockResolvedValue(reply(200, { state: 'sent', provider: 'africastalking', providerMessageId: 'AT1' }));
    const result = await sendPatientText({
      patient: PATIENT, text: 'Your prescription', subject: 'Your prescription',
      kind: 'prescription', sender: SENDER, consentConfirmed: true,
    });

    expect(result.outcome).toBe('sent');
    const [url, init] = apiFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/patient-sms');
    const sentBody = JSON.parse(String(init.body));
    // No destination is sent — the server reads the number from the record.
    // The tail only lets it refuse if that record has changed since consent.
    expect(sentBody).toEqual({
      patientId: 'pat-1', text: 'Your prescription', messageId: result.message._id, purpose: 'prescription',
      phoneTail: '345145', consentConfirmed: true,
    });

    const doc = await stored(result.message._id);
    expect(doc.channel).toBe('sms');
    expect(doc.messageKind).toBe('prescription');
    expect(doc.textConsentConfirmed).toBe(true);
    expect(doc.smsDelivery).toMatchObject({ state: 'sent', attempts: 1 });
    expect(doc.smsResult).toMatchObject({ ok: true, providerId: 'africastalking', providerMessageId: 'AT1' });
    expect(doc.status).toBe('sent');
  });

  it('queues the text without calling the server when the device is offline', async () => {
    setOnline(false);
    const result = await sendPatientText({ patient: PATIENT, text: 'x', subject: 's', sender: SENDER });
    expect(result.outcome).toBe('queued');
    expect(apiFetch).not.toHaveBeenCalled();
    // Being offline is not an attempt: no backoff, no retry spent.
    const delivery = (await stored(result.message._id)).smsDelivery!;
    expect(delivery).toMatchObject({ state: 'queued', attempts: 0, error: 'offline' });
    expect(delivery.lastAttemptAt).toBeUndefined();
  });

  it('queues on a network error and on the retryable server answers', async () => {
    apiFetch.mockRejectedValueOnce(new Error('Failed to fetch'));
    expect((await sendPatientText({ patient: PATIENT, text: 'x', subject: 's', sender: SENDER })).outcome).toBe('queued');
    for (const status of [401, 409, 429, 503]) {
      apiFetch.mockResolvedValueOnce(reply(status, { error: 'later' }));
      expect((await sendPatientText({ patient: PATIENT, text: 'x', subject: 's', sender: SENDER })).outcome).toBe('queued');
    }
  });

  it('marks an SMS-only message failed when the deployment has no gateway', async () => {
    apiFetch.mockResolvedValue(reply(200, { state: 'not_connected', provider: 'noop' }));
    const result = await sendPatientText({ patient: PATIENT, text: 'x', subject: 's', sender: SENDER });
    expect(result.outcome).toBe('not_connected');
    const doc = await stored(result.message._id);
    expect(doc.smsDelivery?.state).toBe('not_connected');
    expect(doc.smsResult).toMatchObject({ ok: false, providerId: 'noop' });
    // Nobody was reached, so the record must not read "sent".
    expect(doc.status).toBe('failed');
  });

  it('keeps an app + SMS message delivered in the inbox when only the text failed', async () => {
    apiFetch.mockResolvedValue(reply(200, { state: 'not_connected', provider: 'noop' }));
    const result = await sendPatientText({ patient: PATIENT, text: 'x', subject: 's', sender: SENDER, channel: 'both' });
    expect((await stored(result.message._id)).status).toBe('sent');
  });

  it('sends a text once even if the outbox fires while the first request is in flight', async () => {
    let release: (value: unknown) => void = () => {};
    apiFetch.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    const sending = sendPatientText({ patient: PATIENT, text: 'x', subject: 's', sender: SENDER });
    // The message is written and queued; its first request has not returned.
    await new Promise(resolve => setTimeout(resolve, 30));
    const flush = await flushQueuedPatientTexts('user-dr-wani', SCOPE);
    expect(flush.attempted).toBe(0);
    release(reply(200, { state: 'sent', provider: 'africastalking' }));
    expect((await sending).outcome).toBe('sent');
    expect(apiFetch).toHaveBeenCalledTimes(1);
  });

  it('fails at once, with the reason, when the record no longer holds the confirmed number', async () => {
    // Waiting cannot fix a changed number. Queued for retry, this read as
    // "saved — will send when online" for hours, and the caller went on to
    // act as if the text were on its way.
    apiFetch.mockResolvedValue(reply(409, { error: 'phone_changed' }));
    const result = await sendPatientText({ patient: PATIENT, text: 'x', subject: 's', sender: SENDER, consentConfirmed: true });
    expect(result.outcome).toBe('failed');
    expect(result.error).toMatch(/not the one this text was written for/);
    expect(apiFetch).toHaveBeenCalledTimes(1);
  });

  it('still waits out the 409s that do resolve on their own', async () => {
    for (const error of ['patient_not_synced', 'in_flight']) {
      apiFetch.mockResolvedValue(reply(409, { error }));
      const result = await sendPatientText({ patient: PATIENT, text: 'x', subject: 's', sender: SENDER, consentConfirmed: true });
      expect(result.outcome).toBe('queued');
    }
  });

  it('tells the server whether the sender confirmed consent', async () => {
    apiFetch.mockResolvedValue(reply(422, { error: 'consent_required' }));
    const result = await sendPatientText({ patient: PATIENT, text: 'x', subject: 's', sender: SENDER });
    expect(JSON.parse(String((apiFetch.mock.calls[0] as [string, RequestInit])[1].body)).consentConfirmed).toBe(false);
    expect(result.outcome).toBe('failed');
    expect(result.error).toMatch(/agreed to receive texts/);
  });

  it('fails outright on a verdict that retrying cannot change', async () => {
    apiFetch.mockResolvedValue(reply(422, { error: 'no_phone' }));
    const result = await sendPatientText({ patient: PATIENT, text: 'x', subject: 's', sender: SENDER });
    expect(result.outcome).toBe('failed');
    expect(result.error).toMatch(/No phone number/);
  });
});

describe('retrying queued texts', () => {
  it('gives up after the attempt ceiling instead of retrying forever', async () => {
    apiFetch.mockRejectedValue(new Error('Failed to fetch'));
    const first = await sendPatientText({ patient: PATIENT, text: 'x', subject: 's', sender: SENDER });
    let message = first.message;
    let outcome = first.outcome;
    for (let i = 1; i < MAX_TEXT_ATTEMPTS; i++) {
      const next = await dispatchPatientText(message);
      message = next.message;
      outcome = next.outcome;
    }
    expect(outcome).toBe('failed');
    expect(message.smsDelivery).toMatchObject({ state: 'failed', attempts: MAX_TEXT_ATTEMPTS });
  });

  it('respects the backoff window', () => {
    const now = new Date('2026-10-03T10:00:00.000Z');
    const queued = (attempts: number, minutesAgo: number) => ({
      smsDelivery: { state: 'queued', attempts, lastAttemptAt: new Date(now.getTime() - minutesAgo * 60_000).toISOString() },
    } as MessageDoc);
    expect(isTextRetryDue(queued(1, 0.5), now)).toBe(false);
    expect(isTextRetryDue(queued(1, 2), now)).toBe(true);
    expect(isTextRetryDue(queued(3, 10), now)).toBe(false);
    expect(isTextRetryDue(queued(3, 16), now)).toBe(true);
    expect(isTextRetryDue({ smsDelivery: { state: 'sent', attempts: 1 } } as MessageDoc, now)).toBe(false);
    expect(isTextRetryDue({} as MessageDoc, now)).toBe(false);
  });

  it('never sends a queued message it was not asked to send, even one carrying this user\'s id', async () => {
    // Authorship is a field on a replicated document; the sync validator does
    // not check who wrote it. A message written elsewhere with this user's id
    // arrives looking exactly like one of their own queued texts.
    const now = new Date().toISOString();
    await messagesDB().put({
      _id: 'msg-planted', type: 'message', recipientType: 'patient', patientId: 'pat-1', patientName: 'Mary Akol',
      patientPhone: '0912345145', fromDoctorId: 'user-dr-wani', fromDoctorName: 'Dr. James Wani',
      fromHospitalName: 'Wau State Hospital', subject: 's', body: 'Pay 5000 SSP to this number', channel: 'sms',
      status: 'sent', sentAt: now, orgId: 'org-1', textConsentConfirmed: true,
      smsDelivery: { state: 'queued', attempts: 0 }, createdAt: now, updatedAt: now,
    } as unknown as MessageDoc);

    apiFetch.mockResolvedValue(reply(200, { state: 'sent', provider: 'africastalking' }));
    const outcome = await flushQueuedPatientTexts('user-dr-wani', SCOPE);

    expect(outcome).toMatchObject({ attempted: 0, sent: 0 });
    expect(apiFetch).not.toHaveBeenCalled();
    expect((await stored('msg-planted')).smsDelivery?.state).toBe('queued');
  });

  it('stops retrying a text once it has settled', async () => {
    apiFetch.mockResolvedValue(reply(200, { state: 'sent', provider: 'africastalking' }));
    await sendPatientText({ patient: PATIENT, text: 'x', subject: 's', sender: SENDER, consentConfirmed: true });
    apiFetch.mockClear();
    expect(await flushQueuedPatientTexts('user-dr-wani', SCOPE)).toMatchObject({ attempted: 0 });
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it('sends this user\'s queued texts once the device is back online', async () => {
    setOnline(false);
    const queued = await sendPatientText({ patient: PATIENT, text: 'x', subject: 's', sender: SENDER });
    // Someone else's queued text on the same (replicated) database.
    const other = await sendPatientText({ patient: PATIENT, text: 'y', subject: 's', sender: { ...SENDER, _id: 'user-other' } });

    // No waiting: a text queued for lack of a connection is due at once.
    setOnline(true);
    apiFetch.mockResolvedValue(reply(200, { state: 'sent', provider: 'africastalking' }));
    const outcome = await flushQueuedPatientTexts('user-dr-wani', SCOPE);

    expect(outcome).toMatchObject({ attempted: 1, sent: 1, stillQueued: 0, failed: 0 });
    expect((await stored(queued.message._id)).smsDelivery?.state).toBe('sent');
    // Only the author's own device retries a message.
    expect((await stored(other.message._id)).smsDelivery?.state).toBe('queued');
  });

  it('waits out the backoff after a real failed attempt', async () => {
    apiFetch.mockResolvedValueOnce(reply(503, { error: 'down' }));
    const queued = await sendPatientText({ patient: PATIENT, text: 'x', subject: 's', sender: SENDER });
    expect((await stored(queued.message._id)).smsDelivery).toMatchObject({ state: 'queued', attempts: 1 });
    apiFetch.mockResolvedValue(reply(200, { state: 'sent', provider: 'africastalking' }));
    // Seconds later the server is asked again by the outbox: too soon.
    expect(await flushQueuedPatientTexts('user-dr-wani', SCOPE)).toMatchObject({ attempted: 0 });
  });

  it('does nothing while still offline', async () => {
    setOnline(false);
    await sendPatientText({ patient: PATIENT, text: 'x', subject: 's', sender: SENDER });
    expect(await flushQueuedPatientTexts('user-dr-wani', SCOPE)).toMatchObject({ attempted: 0 });
  });
});

describe('a texted prescription', () => {
  async function seedRx(overrides: Partial<PrescriptionDoc> = {}): Promise<string> {
    const doc = {
      _id: 'rx-1', type: 'prescription', patientId: 'pat-1', patientName: 'Mary Akol', medication: 'Amoxicillin',
      dose: '500mg', route: 'Capsule', frequency: 'Three times daily', duration: '5 days', prescribedBy: 'Dr. James Wani',
      status: 'pending', orderStatus: 'prescribed', fulfilment: 'external',
      createdAt: '2026-10-03T08:00:00.000Z', updatedAt: '2026-10-03T08:00:00.000Z', ...overrides,
    } as PrescriptionDoc;
    await prescriptionsDB().put(doc);
    return doc._id;
  }

  it('is recorded as given to the patient only once the gateway accepts it', async () => {
    const rxId = await seedRx();
    setOnline(false);
    const queued = await sendPatientText({
      patient: PATIENT, text: 'Your prescription', subject: 's', kind: 'prescription', sender: SENDER, prescriptionIds: [rxId],
    });
    let rx = await prescriptionsDB().get(rxId) as PrescriptionDoc;
    expect(rx.patientCopies).toBeUndefined();
    expect(rx.issuedToPatientAt).toBeUndefined();

    setOnline(true);
    apiFetch.mockResolvedValue(reply(200, { state: 'sent', provider: 'africastalking' }));
    await dispatchPatientText(await stored(queued.message._id));

    rx = await prescriptionsDB().get(rxId) as PrescriptionDoc;
    expect(rx.patientCopies).toHaveLength(1);
    expect(rx.patientCopies![0]).toMatchObject({
      channel: 'sms', byName: 'Dr. James Wani', messageId: queued.message._id, to: '091•••••145',
    });
    // The handover is what releases an outside-pharmacy script from checkout.
    expect(rx.issuedToPatientAt).toBeTruthy();
  });

  it('records the number the server says it used, not this device\'s copy', async () => {
    const rxId = await seedRx();
    apiFetch.mockResolvedValue(reply(200, { state: 'sent', provider: 'africastalking', to: '092•••••777' }));
    const result = await sendPatientText({
      patient: PATIENT, text: 'x', subject: 's', kind: 'prescription', sender: SENDER, prescriptionIds: [rxId],
    });
    const rx = await prescriptionsDB().get(rxId) as PrescriptionDoc;
    expect(rx.patientCopies![0].to).toBe('092•••••777');
    expect((await stored(result.message._id)).smsDelivery?.to).toBe('092•••••777');
  });

  it('is not recorded when nothing was sent', async () => {
    const rxId = await seedRx();
    apiFetch.mockResolvedValue(reply(200, { state: 'not_connected', provider: 'noop' }));
    await sendPatientText({ patient: PATIENT, text: 'x', subject: 's', kind: 'prescription', sender: SENDER, prescriptionIds: [rxId] });
    const rx = await prescriptionsDB().get(rxId) as PrescriptionDoc;
    expect(rx.patientCopies).toBeUndefined();
    expect(rx.issuedToPatientAt).toBeUndefined();
  });
});
