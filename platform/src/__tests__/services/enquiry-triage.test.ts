/**
 * @jest-environment node
 *
 * Patient-enquiry triage (lib/services/enquiry-service.ts).
 *
 * Enquiries are `MessageDoc`s with triage state carried on optional fields, so
 * the load-bearing rule is that ABSENT reads as 'new' — every message written
 * before triage existed is untouched work, not work in an unknown state. These
 * tests pin that, and pin that delivery status is never mistaken for it.
 */

import {
  ENQUIRY_STATUSES,
  deriveEnquiryStatus,
  isOpenEnquiry,
  enquiryType,
  enquiryAssignee,
  summariseEnquiries,
  filterEnquiries,
} from '@/lib/services/enquiry-service';
import type { MessageDoc } from '@/lib/db-types';

function enquiry(overrides: Partial<MessageDoc> = {}): MessageDoc {
  return {
    _id: `msg-${Math.abs(overrides.sentAt?.length ?? 1)}-${overrides.patientName || 'x'}`,
    type: 'message',
    direction: 'patient_to_staff',
    patientId: 'pat-1',
    patientName: 'Aya Deng',
    patientPhone: '+211900000000',
    fromDoctorId: 'patient',
    fromDoctorName: 'Aya Deng',
    fromHospitalName: 'Juba Teaching Hospital',
    subject: 'Appointment time',
    body: 'Can I move my appointment?',
    channel: 'app',
    status: 'sent',
    sentAt: '2026-08-10T09:00:00.000Z',
    createdAt: '2026-08-10T09:00:00.000Z',
    updatedAt: '2026-08-10T09:00:00.000Z',
    ...overrides,
  } as MessageDoc;
}

describe('deriveEnquiryStatus', () => {
  test('a message with no triage state is new, not unknown', () => {
    expect(deriveEnquiryStatus(enquiry())).toBe('new');
  });

  test('an explicit status is returned as-is', () => {
    for (const status of ENQUIRY_STATUSES) {
      expect(deriveEnquiryStatus(enquiry({ enquiryStatus: status }))).toBe(status);
    }
  });

  test('an unrecognised status falls back to new rather than disappearing from every filter', () => {
    const fromNewerClient = { enquiryStatus: 'escalated' } as unknown as MessageDoc;
    expect(deriveEnquiryStatus(fromNewerClient)).toBe('new');
  });

  test('delivery status is not triage status', () => {
    // 'delivered' is the SMS gateway's word, not the front desk's.
    expect(deriveEnquiryStatus(enquiry({ status: 'delivered' }))).toBe('new');
  });
});

describe('isOpenEnquiry', () => {
  test('new and contacted are open; scheduled and closed are not', () => {
    expect(isOpenEnquiry(enquiry())).toBe(true);
    expect(isOpenEnquiry(enquiry({ enquiryStatus: 'contacted' }))).toBe(true);
    expect(isOpenEnquiry(enquiry({ enquiryStatus: 'appointment_scheduled' }))).toBe(false);
    expect(isOpenEnquiry(enquiry({ enquiryStatus: 'closed' }))).toBe(false);
  });
});

describe('enquiryType / enquiryAssignee', () => {
  test('type falls back to a generic label when the subject is blank', () => {
    expect(enquiryType(enquiry({ subject: 'Medication question' }))).toBe('Medication question');
    expect(enquiryType(enquiry({ subject: '   ' }))).toBe('General enquiry');
  });

  test('assignee is null when unassigned', () => {
    expect(enquiryAssignee(enquiry())).toBeNull();
    expect(enquiryAssignee(enquiry({ enquiryAssignedToName: 'Amira Juma' }))).toBe('Amira Juma');
  });
});

describe('summariseEnquiries', () => {
  test('counts every status and reports the most recent timestamp', () => {
    const summary = summariseEnquiries([
      enquiry({ sentAt: '2026-08-01T08:00:00.000Z' }),                                  // new
      enquiry({ enquiryStatus: 'contacted', sentAt: '2026-08-12T08:00:00.000Z' }),
      enquiry({ enquiryStatus: 'closed', sentAt: '2026-08-05T08:00:00.000Z' }),
      enquiry({ enquiryStatus: 'appointment_scheduled', sentAt: '2026-08-03T08:00:00.000Z' }),
    ]);
    expect(summary.total).toBe(4);
    expect(summary.open).toBe(2); // new + contacted
    expect(summary.byStatus).toEqual({ new: 1, contacted: 1, appointment_scheduled: 1, closed: 1 });
    expect(summary.lastAt).toBe('2026-08-12T08:00:00.000Z');
  });

  test('an empty list reports zeroes and no last timestamp', () => {
    const summary = summariseEnquiries([]);
    expect(summary).toEqual({
      total: 0, open: 0, lastAt: null,
      byStatus: { new: 0, contacted: 0, appointment_scheduled: 0, closed: 0 },
    });
  });
});

describe('filterEnquiries', () => {
  const rows = [
    enquiry({ patientName: 'Aya Deng', subject: 'Appointment time', sentAt: '2026-08-01T08:00:00.000Z' }),
    enquiry({ patientName: 'Bol Garang', subject: 'Medication question', enquiryStatus: 'contacted', enquiryAssignedToId: 'user-a', enquiryAssignedToName: 'Amira', sentAt: '2026-08-10T08:00:00.000Z' }),
    enquiry({ patientName: 'Chol Ring', subject: 'Appointment time', enquiryStatus: 'closed', sentAt: '2026-08-20T08:00:00.000Z' }),
  ];

  test('no filters returns everything', () => {
    expect(filterEnquiries(rows, {})).toHaveLength(3);
  });

  test('status filter uses the derived status, so untriaged rows match "new"', () => {
    const result = filterEnquiries(rows, { status: 'new' });
    expect(result.map(r => r.patientName)).toEqual(['Aya Deng']);
  });

  test('type filter matches the subject line', () => {
    expect(filterEnquiries(rows, { type: 'Appointment time' })).toHaveLength(2);
  });

  test('assignedTo supports a specific staff id and the unassigned bucket', () => {
    expect(filterEnquiries(rows, { assignedTo: 'user-a' }).map(r => r.patientName)).toEqual(['Bol Garang']);
    expect(filterEnquiries(rows, { assignedTo: 'unassigned' })).toHaveLength(2);
  });

  test('date bounds are inclusive on both ends', () => {
    expect(filterEnquiries(rows, { from: '2026-08-10', to: '2026-08-20' })).toHaveLength(2);
    expect(filterEnquiries(rows, { from: '2026-08-10', to: '2026-08-10' })).toHaveLength(1);
  });

  test('search spans patient name, subject and assignee', () => {
    expect(filterEnquiries(rows, { search: 'chol' })).toHaveLength(1);
    expect(filterEnquiries(rows, { search: 'medication' })).toHaveLength(1);
    expect(filterEnquiries(rows, { search: 'amira' })).toHaveLength(1);
  });

  test('filters compose (status AND type)', () => {
    expect(filterEnquiries(rows, { status: 'closed', type: 'Appointment time' })).toHaveLength(1);
    expect(filterEnquiries(rows, { status: 'closed', type: 'Medication question' })).toHaveLength(0);
  });
});
