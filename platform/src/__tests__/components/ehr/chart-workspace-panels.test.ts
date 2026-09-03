/**
 * Minimum-necessary coverage for the patient chart's right-hand workspace rail
 * (`visibleDrawerPanels`, src/components/ehr/chart/TamamChartShell.tsx).
 *
 * The chart is reachable by roles that are deliberately denied the clinical
 * tabs — reception, cashiers, the lab bench, pharmacy — via ADMIN_TAB_IDS /
 * LAB_TAB_IDS / PHARMACY_TAB_IDS in the chart page. The right rail renders
 * independently of those tab sets, so it has to apply the same rule or it
 * becomes a second door onto the same clinical detail: the order basket lists
 * the patient's drug and lab orders, the clinical-forms list dates their last
 * consultation, triage stop and ward admission, and the visit note writes a
 * diagnosis.
 */
import { visibleDrawerPanels } from '@/components/ehr/chart/TamamChartShell';

const ids = (canViewClinical: boolean) => visibleDrawerPanels(canViewClinical).map(p => p.id);

describe('visibleDrawerPanels', () => {
  it('gives a clinical viewer the full workspace rail', () => {
    expect(ids(true)).toEqual([
      'order-basket',
      'visit-note',
      'task-list',
      'clinical-forms',
      'patient-lists',
    ]);
  });

  it('withholds every clinical panel from a non-clinical viewer', () => {
    const visible = ids(false);
    expect(visible).not.toContain('order-basket');
    expect(visible).not.toContain('visit-note');
    expect(visible).not.toContain('clinical-forms');
  });

  it('keeps the non-clinical panels, so the rail is not simply emptied', () => {
    // Recall reminders and patient lists are front-desk work — ADMIN_TAB_IDS
    // carries 'recall' for exactly that reason.
    expect(ids(false)).toEqual(['task-list', 'patient-lists']);
  });

  it('preserves rail order across both permission levels', () => {
    const clinical = ids(true);
    const restricted = ids(false);
    expect(restricted).toEqual(clinical.filter(id => restricted.includes(id)));
  });
});
