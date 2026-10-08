/**
 * @jest-environment node
 *
 * The patient ↔ care-team conversation: who a portal reply is for, how the
 * thread reads, which replies are still waiting — and that a reply sent from
 * the portal actually lands where staff can see it.
 */
import type { MessageDoc } from '@/lib/db-types';
import {
  isFromPatient, isToPatient, patientThread, resolveReplyRecipient, unansweredPatientMessages,
} from '@/modules/communication/services/patient-thread-service';
import { patientMessageNotificationItems } from '@/modules/communication/notifications/patient-message-items';
import { filterByScope, type DataScope } from '@/lib/services/data-scope';

let seq = 0;
const msg = (over: Partial<MessageDoc>): MessageDoc => ({
  _id: `msg-${++seq}`, type: 'message', patientId: 'pat-1', patientName: 'Deng Mabior Garang', patientPhone: '',
  direction: 'staff_to_patient', recipientType: 'patient',
  fromDoctorId: 'user-dr-wani', fromDoctorName: 'Dr. James Wani', fromHospitalName: 'Juba Teaching Hospital',
  subject: 's', body: 'b', channel: 'app', status: 'sent',
  sentAt: `2026-10-08T0${seq % 10}:00:00.000Z`, createdAt: '2026-10-08T00:00:00.000Z', updatedAt: '2026-10-08T00:00:00.000Z',
  ...over,
});
const fromPatient = (over: Partial<MessageDoc>) => msg({
  direction: 'patient_to_staff', recipientType: 'staff', fromDoctorId: 'patient', fromDoctorName: 'Deng Mabior Garang', ...over,
});

describe('the thread', () => {
  it('reads oldest first and leaves staff chat out', () => {
    const rows = [
      msg({ _id: 'b', sentAt: '2026-10-08T10:00:00Z' }),
      fromPatient({ _id: 'a', sentAt: '2026-10-08T09:00:00Z' }),
      msg({ _id: 'chat', direction: 'staff_to_staff', sentAt: '2026-10-08T09:30:00Z' }),
    ];
    expect(patientThread(rows).map(m => m._id)).toEqual(['a', 'b']);
  });

  it('recognises a patient message with or without the direction field', () => {
    expect(isFromPatient({ direction: 'patient_to_staff', fromDoctorId: 'x' })).toBe(true);
    expect(isFromPatient({ direction: undefined, fromDoctorId: 'patient' })).toBe(true);
    expect(isFromPatient({ direction: 'staff_to_patient', fromDoctorId: 'user-dr-wani' })).toBe(false);
  });
});

describe('internal alerts about a patient are not part of their conversation', () => {
  // What the lab writes for a critical result: the patient's id, a staff
  // recipient, and no direction.
  const alert = (over: Partial<MessageDoc> = {}) => msg({
    direction: undefined, recipientType: 'staff', fromDoctorId: 'user-lab-tech', fromDoctorName: 'Lab Tech', ...over,
  });

  it('is not a message to the patient', () => {
    expect(isToPatient(alert())).toBe(false);
    expect(isToPatient(msg({}))).toBe(true);
    // Legacy: no direction and no recipient type meant "to the patient".
    expect(isToPatient(msg({ direction: undefined, recipientType: undefined }))).toBe(true);
    expect(isToPatient(fromPatient({}))).toBe(false);
  });

  it('stays out of the thread, the reply address and the "answered" test', () => {
    const rows = [
      msg({ _id: 'dr', sentAt: '2026-10-08T08:00:00Z' }),
      fromPatient({ _id: 'q', recipientStaffId: 'user-dr-wani', sentAt: '2026-10-08T09:00:00Z' }),
      alert({ _id: 'alert', sentAt: '2026-10-08T10:00:00Z' }),
    ];
    expect(patientThread(rows).map(m => m._id)).toEqual(['dr', 'q']);
    expect(resolveReplyRecipient(rows, null)?.id).toBe('user-dr-wani');
    // The alert came after the question and is not an answer to it.
    expect(unansweredPatientMessages(rows, 'user-dr-wani').map(m => m._id)).toEqual(['q']);
  });
});

describe('who a patient’s reply is for', () => {
  it('is the clinician who last wrote to them', () => {
    const thread = [
      msg({ fromDoctorId: 'user-dr-achol', fromDoctorName: 'Dr. Achol', sentAt: '2026-10-01T08:00:00Z' }),
      msg({ fromDoctorId: 'user-dr-wani', fromDoctorName: 'Dr. James Wani', sentAt: '2026-10-07T08:00:00Z' }),
      fromPatient({ sentAt: '2026-10-07T09:00:00Z' }),
    ];
    expect(resolveReplyRecipient(thread, { assignedDoctor: 'user-dr-achol' }))
      .toMatchObject({ id: 'user-dr-wani', name: 'Dr. James Wani' });
  });

  it('falls back to the assigned doctor when nobody has written yet', () => {
    expect(resolveReplyRecipient([], { assignedDoctor: 'user-dr-achol', assignedDoctorName: 'Dr. Achol' }))
      .toEqual({ id: 'user-dr-achol', name: 'Dr. Achol' });
  });

  it('is nobody when there is no clinician to address — the front desk keeps it', () => {
    expect(resolveReplyRecipient([fromPatient({})], {})).toBeUndefined();
    expect(resolveReplyRecipient([], null)).toBeUndefined();
  });

  it('ignores a message the clinician removed', () => {
    const thread = [msg({ fromDoctorId: 'user-dr-wani', deleted: true })];
    expect(resolveReplyRecipient(thread, { assignedDoctor: 'user-dr-achol' })?.id).toBe('user-dr-achol');
  });
});

describe('replies still waiting on an answer', () => {
  const mine = { recipientStaffId: 'user-dr-wani' };

  it('lists a patient message addressed to me that nobody has answered', () => {
    const rows = [
      msg({ sentAt: '2026-10-08T08:00:00Z' }),
      fromPatient({ _id: 'waiting', ...mine, sentAt: '2026-10-08T09:00:00Z' }),
    ];
    expect(unansweredPatientMessages(rows, 'user-dr-wani').map(m => m._id)).toEqual(['waiting']);
  });

  it('clears once any staff member has replied to that patient', () => {
    const rows = [
      fromPatient({ ...mine, sentAt: '2026-10-08T09:00:00Z' }),
      msg({ fromDoctorId: 'user-nurse', sentAt: '2026-10-08T09:30:00Z' }),
    ];
    expect(unansweredPatientMessages(rows, 'user-dr-wani')).toEqual([]);
  });

  it('a reply that was then removed does not count as an answer', () => {
    const rows = [
      fromPatient({ _id: 'q', ...mine, sentAt: '2026-10-08T09:00:00Z' }),
      msg({ deleted: true, sentAt: '2026-10-08T09:30:00Z' }),
    ];
    expect(unansweredPatientMessages(rows, 'user-dr-wani').map(m => m._id)).toEqual(['q']);
  });

  it('an automated reminder is not an answer, and not who the patient is replying to', () => {
    const reminder = msg({ _id: 'reminder', automated: true, fromDoctorId: 'user-dr-achol', sentAt: '2026-10-08T10:00:00Z' });
    const rows = [
      msg({ _id: 'dr', fromDoctorId: 'user-dr-wani', sentAt: '2026-10-08T08:00:00Z' }),
      fromPatient({ _id: 'q', ...mine, sentAt: '2026-10-08T09:00:00Z' }),
      reminder,
    ];
    expect(unansweredPatientMessages(rows, 'user-dr-wani').map(m => m._id)).toEqual(['q']);
    expect(resolveReplyRecipient(rows, null)?.id).toBe('user-dr-wani');
    // The patient still sees the reminder in their conversation.
    expect(patientThread(rows).map(m => m._id)).toContain('reminder');
  });

  it('does not show me a colleague’s patient, or an unaddressed enquiry', () => {
    const rows = [
      fromPatient({ recipientStaffId: 'user-dr-achol', sentAt: '2026-10-08T09:00:00Z' }),
      fromPatient({ sentAt: '2026-10-08T09:05:00Z' }),
    ];
    expect(unansweredPatientMessages(rows, 'user-dr-wani')).toEqual([]);
  });

  it('a reply to one patient does not clear another patient’s message', () => {
    const rows = [
      fromPatient({ _id: 'p2', patientId: 'pat-2', ...mine, sentAt: '2026-10-08T09:00:00Z' }),
      msg({ patientId: 'pat-1', sentAt: '2026-10-08T10:00:00Z' }),
    ];
    expect(unansweredPatientMessages(rows, 'user-dr-wani').map(m => m._id)).toEqual(['p2']);
  });

  it('becomes one bell row per patient, opening the conversation on their chart', () => {
    const rows = [
      fromPatient({ _id: 'new', ...mine, body: 'Second question', sentAt: '2026-10-08T09:10:00Z' }),
      fromPatient({ _id: 'old', ...mine, body: 'First question', sentAt: '2026-10-08T09:00:00Z' }),
    ];
    const items = patientMessageNotificationItems(unansweredPatientMessages(rows, 'user-dr-wani'), 5);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      type: 'message', subtitle: 'Second question', href: '/patients/pat-1?tab=messages',
    });
    expect(items[0].title).toContain('Deng');
  });

  it('shows only the start of a long message in the bell', () => {
    const rows = [fromPatient({ ...mine, body: 'word '.repeat(200), sentAt: '2026-10-08T09:00:00Z' })];
    const [item] = patientMessageNotificationItems(unansweredPatientMessages(rows, 'user-dr-wani'), 5);
    expect(item.subtitle.length).toBeLessThanOrEqual(120);
    expect(item.subtitle.endsWith('…')).toBe(true);
  });
});

describe('why the organisation on a reply matters', () => {
  const doctor = { role: 'doctor', orgId: 'org-moh-ss', hospitalId: 'hosp-001', userId: 'user-dr-wani' } as unknown as DataScope;

  it('a reply with no organisation is invisible to the clinic — the bug this fixed', () => {
    const orphan = fromPatient({ recipientHospitalId: 'hosp-001' });
    expect(filterByScope([orphan], doctor)).toEqual([]);
  });

  it('a reply stamped with the patient’s organisation and facility reaches their doctor', () => {
    const routed = fromPatient({ orgId: 'org-moh-ss', recipientHospitalId: 'hosp-001' });
    expect(filterByScope([routed], doctor)).toHaveLength(1);
    const elsewhere = { ...doctor, orgId: 'org-other', hospitalId: 'hosp-999' } as unknown as DataScope;
    expect(filterByScope([routed], elsewhere)).toEqual([]);
  });
});
