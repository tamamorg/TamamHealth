/**
 * @jest-environment node
 *
 * A tenant's status row has to say what the tenant IS.
 *
 * Two fields describe one organization. `isActive` is the lifecycle —
 * deactivating sets it false and touches nothing else. `subscriptionStatus` is
 * the billing plan state, and that is the one the rosters rendered. So a
 * deactivated tenant went on advertising "TRIAL" in its status column while the
 * page header counted it under Suspended, and the console contradicted itself
 * in a single screenful: three organizations, chips reading 2 active + 2 trial
 * + 1 suspended, and no suspended row anywhere in the list.
 */

import { effectiveOrgStatus, statusChip } from '@/components/admin/sadb-ui';

const org = (isActive: boolean, subscriptionStatus: string) => ({ isActive, subscriptionStatus });

describe('effectiveOrgStatus', () => {
  it('reads suspended once the organization is deactivated, whatever it was paying for', () => {
    expect(effectiveOrgStatus(org(false, 'trial'))).toBe('suspended');
    expect(effectiveOrgStatus(org(false, 'active'))).toBe('suspended');
    expect(effectiveOrgStatus(org(false, 'suspended'))).toBe('suspended');
  });

  it('leaves a live organization showing its real billing state', () => {
    expect(effectiveOrgStatus(org(true, 'trial'))).toBe('trial');
    expect(effectiveOrgStatus(org(true, 'active'))).toBe('active');
    // Suspended billing on a live tenant is still suspended — the two fields
    // agree here, and neither one is allowed to hide the other.
    expect(effectiveOrgStatus(org(true, 'suspended'))).toBe('suspended');
  });

  it('does not destroy the plan state underneath', () => {
    // The reason this is derived and not written at deactivation: reactivating
    // has to be able to tell a trial tenant from a paying one.
    const deactivated = org(false, 'trial');
    expect(effectiveOrgStatus(deactivated)).toBe('suspended');
    expect(deactivated.subscriptionStatus).toBe('trial');
    expect(effectiveOrgStatus({ ...deactivated, isActive: true })).toBe('trial');
  });

  it('is red in the chip, so the row reads as suspended at a glance', () => {
    expect(statusChip(effectiveOrgStatus(org(false, 'trial')))).toBe('red');
    expect(statusChip(effectiveOrgStatus(org(true, 'trial')))).toBe('yellow');
  });
});

describe('the header chips partition the list', () => {
  // Whatever the counts are, they must add up to the rows underneath them.
  const orgs = [
    org(true, 'active'), org(true, 'trial'), org(false, 'trial'),
    org(true, 'cancelled'), org(false, 'active'),
  ];
  const status = (o: { isActive: boolean; subscriptionStatus: string }) => effectiveOrgStatus(o);

  it('counts each organization exactly once', () => {
    const active = orgs.filter(o => status(o) === 'active');
    const trial = orgs.filter(o => status(o) === 'trial');
    const suspended = orgs.filter(o => status(o) === 'suspended' || status(o) === 'cancelled');
    expect(active).toHaveLength(1);
    expect(trial).toHaveLength(1);
    expect(suspended).toHaveLength(3);
    expect(active.length + trial.length + suspended.length).toBe(orgs.length);
  });
});
