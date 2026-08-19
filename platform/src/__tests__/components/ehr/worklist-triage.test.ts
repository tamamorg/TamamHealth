/**
 * The worklist's two triage maps (`buildActiveTriageByPatient` /
 * `buildLatestTriageByPatient`, src/components/ehr/EhrClinicalDashboard.tsx).
 *
 * They answer different questions and must not be collapsed into one. The
 * active map decides who is WAITING — membership of the live queue, so it is
 * windowed to the last 24h and a stale record must never re-enter it. The
 * latest map supplies the visit panel's VITALS — the last readings anyone
 * actually took, at any age.
 *
 * Conflating them is what made a ward show vitals for one bed and "no triage
 * vitals recorded" for the next: both patients had been triaged on arrival,
 * but only the recent one was inside the queue window.
 */
import {
  buildActiveTriageByPatient,
  buildLatestTriageByPatient,
} from '@/components/ehr/EhrClinicalDashboard';
import type { TriageDoc } from '@/lib/db-types';

const NOW = Date.parse('2026-08-16T12:00:00.000Z');
const hoursAgo = (h: number) => new Date(NOW - h * 3600_000).toISOString();

const triage = (over: Partial<TriageDoc> & { _id: string; patientId: string; triagedAt: string }): TriageDoc => ({
  type: 'triage',
  patientName: 'Test Patient',
  airway: 'clear',
  breathing: 'normal',
  circulation: 'normal',
  consciousness: 'alert',
  priority: 'GREEN',
  chiefComplaint: 'Test',
  triagedBy: 'user-nurse',
  triagedByName: 'Nurse',
  status: 'pending',
  createdAt: over.triagedAt,
  updatedAt: over.triagedAt,
  ...over,
} as TriageDoc);

describe('active vs latest triage', () => {
  const recent = triage({ _id: 't-recent', patientId: 'pat-1', triagedAt: hoursAgo(2) });
  // The inpatient case: triaged on admission three days ago, still in a bed.
  const admissionDay = triage({ _id: 't-old', patientId: 'pat-2', triagedAt: hoursAgo(72), status: 'admitted' });

  it('windows the queue to the last 24h', () => {
    const active = buildActiveTriageByPatient([recent, admissionDay], NOW);
    expect([...active.keys()]).toEqual(['pat-1']);
  });

  it('keeps the admitted patient out of the queue but not out of their own vitals', () => {
    const active = buildActiveTriageByPatient([recent, admissionDay], NOW);
    const latest = buildLatestTriageByPatient([recent, admissionDay]);
    // The defect this guards: pat-2 is absent from the queue (correct — they
    // are not waiting) and was therefore shown as having no vitals at all.
    expect(active.has('pat-2')).toBe(false);
    expect(latest.get('pat-2')).toBe(admissionDay);
  });

  it('takes the newest record per patient in both maps', () => {
    const older = triage({ _id: 't-1', patientId: 'pat-3', triagedAt: hoursAgo(6) });
    const newer = triage({ _id: 't-2', patientId: 'pat-3', triagedAt: hoursAgo(1) });
    // Input order must not decide the winner — the timestamp does.
    expect(buildLatestTriageByPatient([newer, older]).get('pat-3')).toBe(newer);
    expect(buildLatestTriageByPatient([older, newer]).get('pat-3')).toBe(newer);
    expect(buildActiveTriageByPatient([older, newer], NOW).get('pat-3')).toBe(newer);
  });

  it('reaches back past the queue window for a patient with only old records', () => {
    const lastYear = triage({ _id: 't-ancient', patientId: 'pat-4', triagedAt: hoursAgo(24 * 400) });
    expect(buildActiveTriageByPatient([lastYear], NOW).size).toBe(0);
    expect(buildLatestTriageByPatient([lastYear]).get('pat-4')).toBe(lastYear);
  });

  it('returns nothing from the queue before the wall clock is sampled', () => {
    // Guards the first-paint flash: no `now` means no claim about who waits.
    expect(buildActiveTriageByPatient([recent], null).size).toBe(0);
    // Vitals need no clock, so they stay available.
    expect(buildLatestTriageByPatient([recent]).size).toBe(1);
  });
});
