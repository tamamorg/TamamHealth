/**
 * The `visit` notification source: a clinician is told every time one of THEIR
 * patients moves along the visit ladder, in the ladder's own words.
 *
 * The properties pinned here are the ones the bell's behaviour hangs on:
 * ownership comes from the encounter's assignment fields (nobody else's
 * patients, and unclaimed patients not at all — the triage pool covers those);
 * the item id embeds the status so every transition mints a NEW unread item;
 * upcoming rungs stay silent; closing rungs age out of the feed; and the
 * "ready to call in" rung is the one that escalates past 'info'.
 */
import { visitUpdateItems, dispensedItems } from '@/modules/communication/notifications/visit-updates';
import type { EncounterDoc, PrescriptionDoc } from '@/lib/db-types';

const NOW = Date.parse('2026-09-01T12:00:00.000Z');
const DOCTOR = { _id: 'user-dr-1', name: 'Dr. James Wani Igga', role: 'doctor' as const };

function encounter(overrides: Partial<EncounterDoc>): EncounterDoc {
  return {
    _id: `enc-${Math.random().toString(36).slice(2, 8)}`,
    type: 'clinical_encounter',
    patientId: 'patient-1',
    patientName: 'Nyandeng Deng',
    clinicianId: '',
    clinicianName: '',
    hospitalId: 'hosp-001',
    status: 'ready_for_clinician',
    stageKey: 'clinic',
    snapshot: {},
    labOrderIds: [],
    createdAt: '2026-09-01T10:00:00.000Z',
    updatedAt: '2026-09-01T11:00:00.000Z',
    ...overrides,
  } as EncounterDoc;
}

describe('visitUpdateItems ownership', () => {
  it('emits for visits whose encounter names the viewer, and only those', () => {
    const items = visitUpdateItems([
      encounter({ _id: 'enc-mine', assignedClinicianId: 'user-dr-1' }),
      encounter({ _id: 'enc-nurse', assignedNurseId: 'user-dr-1' }),
      encounter({ _id: 'enc-consulting', clinicianId: 'user-dr-1' }),
      encounter({ _id: 'enc-other', assignedClinicianId: 'user-dr-2' }),
      encounter({ _id: 'enc-unclaimed' }),
    ], DOCTOR, NOW, 100);
    expect(items.map(i => i.id).sort()).toEqual([
      'visit-enc-consulting-ready_for_clinician',
      'visit-enc-mine-ready_for_clinician',
      'visit-enc-nurse-ready_for_clinician',
    ]);
  });

  it('emits nothing for an anonymous viewer', () => {
    expect(visitUpdateItems([encounter({ assignedClinicianId: 'user-dr-1' })], null, NOW, 100)).toEqual([]);
  });
});

describe('one fresh item per rung', () => {
  it('the id embeds the status, so a transition changes the id', () => {
    const before = visitUpdateItems(
      [encounter({ _id: 'enc-1', assignedClinicianId: 'user-dr-1', status: 'triaged_awaiting_destination' })],
      DOCTOR, NOW, 100);
    const after = visitUpdateItems(
      [encounter({ _id: 'enc-1', assignedClinicianId: 'user-dr-1', status: 'ready_for_clinician' })],
      DOCTOR, NOW, 100);
    expect(before[0].id).toBe('visit-enc-1-triaged_awaiting_destination');
    expect(after[0].id).toBe('visit-enc-1-ready_for_clinician');
    // The label is the ladder's own vocabulary — the same words the worklist
    // chip shows — never a parallel notification phrasing that could drift.
    expect(before[0].title).toBe('Triage completed · Nyandeng Deng');
    expect(after[0].title).toBe('Awaiting consultation · Nyandeng Deng');
  });

  it('stamps the item with the last transition time when the trail exists', () => {
    const [item] = visitUpdateItems([encounter({
      assignedClinicianId: 'user-dr-1',
      statusHistory: [
        { from: null, to: 'arrived_at_facility', at: '2026-09-01T09:00:00.000Z' },
        { from: 'arrived_at_facility', to: 'ready_for_clinician', at: '2026-09-01T11:30:00.000Z' },
      ],
    })], DOCTOR, NOW, 100);
    expect(item.time).toBe('2026-09-01T11:30:00.000Z');
  });
});

describe('which rungs speak', () => {
  it('upcoming rungs stay silent — nothing has happened in the building', () => {
    expect(visitUpdateItems(
      [encounter({ assignedClinicianId: 'user-dr-1', status: 'scheduled' }),
       encounter({ assignedClinicianId: 'user-dr-1', status: 'registered' })],
      DOCTOR, NOW, 100)).toEqual([]);
  });

  it('closing rungs show inside the window and age out after it', () => {
    const recent = encounter({
      _id: 'enc-recent', assignedClinicianId: 'user-dr-1', status: 'discharged',
      updatedAt: new Date(NOW - 60 * 60 * 1000).toISOString(),
    });
    const stale = encounter({
      _id: 'enc-stale', assignedClinicianId: 'user-dr-1', status: 'discharged',
      updatedAt: new Date(NOW - 5 * 24 * 60 * 60 * 1000).toISOString(),
    });
    const items = visitUpdateItems([recent, stale], DOCTOR, NOW, 100);
    expect(items.map(i => i.id)).toEqual(['visit-enc-recent-discharged']);
  });

  it('ready-to-call-in is the actionable rung; escalation and death are critical', () => {
    const byStatus = (status: EncounterDoc['status']) =>
      visitUpdateItems([encounter({ assignedClinicianId: 'user-dr-1', status })], DOCTOR, NOW, 100)[0];
    expect(byStatus('ready_for_clinician').severity).toBe('warning');
    expect(byStatus('ready_for_clinician').subtitle).toContain('call them in');
    expect(byStatus('escalated_to_emergency').severity).toBe('critical');
    expect(byStatus('deceased').severity).toBe('critical');
    expect(byStatus('awaiting_pharmacy').severity).toBe('info');
    expect(byStatus('with_clinician').severity).toBe('info');
  });
});

describe('dispensedItems — the loop-closer', () => {
  const rx = (overrides: Partial<PrescriptionDoc>): PrescriptionDoc => ({
    _id: `rx-${Math.random().toString(36).slice(2, 8)}`,
    type: 'prescription',
    patientId: 'patient-1',
    patientName: 'Nyandeng Deng',
    medication: 'Artemether/Lumefantrine',
    dose: '80/480mg', route: 'oral', frequency: 'BD', duration: '3 days',
    prescribedBy: 'Dr. James Wani Igga',
    status: 'dispensed',
    dispensedAt: '2026-09-01T11:45:00.000Z',
    createdAt: '2026-09-01T10:30:00.000Z',
    updatedAt: '2026-09-01T11:45:00.000Z',
    ...overrides,
  } as PrescriptionDoc);

  it("tells the prescriber their patient's medication was dispensed", () => {
    const [item] = dispensedItems([rx({ _id: 'rx-1' })], DOCTOR, NOW, 100);
    expect(item.id).toBe('visit-rx-rx-1');
    expect(item.type).toBe('visit');
    expect(item.title).toBe('Dispensed · Artemether/Lumefantrine');
    expect(item.href).toBe('/patients/patient-1?tab=medications');
  });

  it("skips other prescribers' orders and still-pending ones", () => {
    expect(dispensedItems([
      rx({ prescribedBy: 'Dr. Achol Mayen Deng' }),
      rx({ status: 'pending' }),
    ], DOCTOR, NOW, 100)).toEqual([]);
  });

  it('ages out after the closure window', () => {
    const old = rx({ dispensedAt: new Date(NOW - 5 * 24 * 60 * 60 * 1000).toISOString() });
    expect(dispensedItems([old], DOCTOR, NOW, 100)).toEqual([]);
  });
});
