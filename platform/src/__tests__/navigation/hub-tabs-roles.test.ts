/**
 * Management hub tabs belong to the management roles' nav. Clinical staff on a
 * page that sits in a hub (a doctor on /patients, a pharmacist on /pharmacy)
 * get no tabs, and so keep their Back bar; and the management frame does not
 * restyle the registers front-line staff open.
 */
jest.mock('@/lib/context', () => ({ useAuth: () => ({ currentUser: null }) }));
jest.mock('next/navigation', () => ({ usePathname: () => '/' }));

import { hubTabsFor } from '@/components/navigation/ModuleHubTabs';
import { MODULE_HUBS } from '@/lib/navigation/module-hubs';
import { isManagementSurface } from '@/lib/navigation/management-surface';

const hubPages = MODULE_HUBS.flatMap(hub => hub.members.map(m => m.href));

describe('hub tabs', () => {
  it.each(['doctor', 'nurse', 'pharmacist', 'lab_tech', 'front_desk'] as const)('never shows hub tabs to %s', (role) => {
    for (const href of hubPages) expect(hubTabsFor(href, role)).toBeNull();
  });

  it('shows them to a management role on its own hub pages', () => {
    const shown = hubPages.filter(href => hubTabsFor(href, 'hospital_manager'));
    expect(shown.length).toBeGreaterThan(0);
  });

  it('shows nothing without a role', () => {
    expect(hubTabsFor(hubPages[0], undefined)).toBeNull();
  });
});

describe('management frame on shared registers', () => {
  it('keeps the clinical frame for front-line staff on a register they share', () => {
    expect(isManagementSurface('/blood-bank', 'doctor')).toBe(false);
    expect(isManagementSurface('/controlled-substances', 'pharmacist')).toBe(false);
    expect(isManagementSurface('/inquiries', 'front_desk')).toBe(false);
  });

  it('still frames the same register for a management role', () => {
    expect(isManagementSurface('/blood-bank', 'hospital_manager')).toBe(true);
    expect(isManagementSurface('/inquiries', 'org_admin')).toBe(true);
  });

  it('still frames the consoles whoever opens them', () => {
    expect(isManagementSurface('/admin', 'doctor')).toBe(true);
  });
});
