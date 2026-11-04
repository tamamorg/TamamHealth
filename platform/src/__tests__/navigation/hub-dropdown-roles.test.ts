import { hubTabsFor } from '@/components/navigation/ModuleHubTabs';

describe('hub dropdown by role', () => {
  it('a doctor on /patients gets no hub dropdown', () => {
    expect(hubTabsFor('/patients', 'doctor')).toBeNull();
  });
  it('a manager on /patients gets the five pages', () => {
    const tabs = hubTabsFor('/patients', 'hospital_manager' as never);
    expect(tabs?.members).toHaveLength(5);
  });
  it('no role, no dropdown', () => {
    expect(hubTabsFor('/patients', undefined)).toBeNull();
  });
});
