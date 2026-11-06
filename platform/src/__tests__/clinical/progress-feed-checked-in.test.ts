import { buildProgressFeed } from '@/lib/clinical-flow/progress-feed';

const at = '2026-11-05T10:00:00.000Z';
const base = { patientId: 'p1', patientName: 'Test Patient', triagedAt: at };

describe('progress feed - walk-in check-in vs real triage', () => {
  const opts = { nowMs: Date.parse(at) + 60_000 };

  it('reports a clerical check-in placeholder as checked in, not triaged', () => {
    const [ev] = buildProgressFeed({ triages: [{ _id: 't1', ...base, assessmentSource: 'clerical_checkin' }] }, opts);
    expect(ev.kind).toBe('checked_in');
    expect(ev.label).toMatch(/checked in/);
    expect(ev.label).not.toBe('triaged');
  });

  it('reports a clinician assessment as triaged', () => {
    const [ev] = buildProgressFeed({ triages: [{ _id: 't2', ...base, assessmentSource: 'clinician' }] }, opts);
    expect(ev.kind).toBe('triaged');
    expect(ev.label).toBe('triaged');
  });
});
