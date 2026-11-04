import { ancHighRiskItems } from '@/modules/communication/notifications/anc-alerts';
import type { ANCVisitDoc } from '@/lib/db-types';

const now = Date.parse('2026-11-04T12:00:00Z');
const visit = (id: string, riskLevel: ANCVisitDoc['riskLevel'], createdAt: string) => ({
  _id: id, type: 'anc_visit', motherId: `m-${id}`, motherName: `Mother ${id}`, visitNumber: 2, visitDate: createdAt.slice(0, 10),
  facilityId: 'h-a', riskLevel, riskFactors: ['pre-eclampsia'], createdAt, updatedAt: createdAt,
}) as unknown as ANCVisitDoc;

const visits = [
  visit('a', 'high', '2026-11-04T08:00:00Z'),
  visit('b', 'moderate', '2026-11-04T08:00:00Z'),
  visit('c', 'high', '2026-10-20T08:00:00Z'),
];

it('a recent high-risk visit reaches a midwife, linked to the ANC tab of the chart', () => {
  const items = ancHighRiskItems(visits, { role: 'midwife' }, now, 10);
  expect(items).toEqual([expect.objectContaining({
    id: 'anc-risk-a', severity: 'warning', title: 'Mother a', href: '/patients/m-a?tab=anc',
  })]);
  expect(items[0].subtitle).toContain('pre-eclampsia');
});

it('reaches clinicians, not the front desk or the lab', () => {
  expect(ancHighRiskItems(visits, { role: 'doctor' }, now, 10)).toHaveLength(1);
  expect(ancHighRiskItems(visits, { role: 'front_desk' }, now, 10)).toEqual([]);
  expect(ancHighRiskItems(visits, { role: 'lab_tech' }, now, 10)).toEqual([]);
});
