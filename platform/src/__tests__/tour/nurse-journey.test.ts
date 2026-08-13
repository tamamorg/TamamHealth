import { journeyTourForRole } from '@/lib/tour/journey-tours';
import type { UserRole } from '@/lib/db-types';

const NURSING_ROLES: UserRole[] = ['nurse', 'midwife', 'triage_nurse', 'rooming_nurse'];
const NURSE_DASHBOARD = '/dashboard/nurse';

describe.each(NURSING_ROLES)('%s guided journey', role => {
  const tour = journeyTourForRole(role);

  it('uses the canonical nurse dashboard for every station step', () => {
    expect(tour).toBeDefined();

    const stationSteps = tour!.steps.filter(step => [
      'triage',
      'triage-disposition',
      'ward-board',
      'mar',
      'rooming',
      'handoff',
    ].includes(step.id));

    expect(stationSteps).toHaveLength(6);
    expect(stationSteps.every(step => step.route === NURSE_DASHBOARD)).toBe(true);
    expect(tour!.steps.some(step => /^\/dashboard\/nurse\/(triage|ward|mar|handoff)$/.test(step.route))).toBe(false);
  });

  it('reveals each station through a stable tour selector', () => {
    const selectorByStep = Object.fromEntries(
      tour!.steps.map(step => [step.id, step.preClickSelector]),
    );

    expect(selectorByStep).toMatchObject({
      triage: '[data-tour-tab="triage"]',
      'triage-disposition': '[data-tour-tab="triage"]',
      'ward-board': '[data-tour-tab="ward"]',
      mar: '[data-tour-tab="mar"]',
      rooming: '[data-tour-tab="rooming"]',
      handoff: '[data-tour="start-handoff"]',
      search: '[data-tour="handoff-sbar"] .ehr-handoff-close',
    });
  });
});
