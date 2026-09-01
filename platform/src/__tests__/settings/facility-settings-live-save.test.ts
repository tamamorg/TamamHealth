jest.mock('@/lib/db', () => require('../helpers/test-db').createDBMock());

import { saveFacilitySettings } from '@/lib/settings/settings-service';
import { getSettings, setSettings, subscribeSettings } from '@/lib/settings/settings-store';
import { DEFAULT_FACILITY_SETTINGS } from '@/lib/settings/facility-settings';
import { teardownTestDBs } from '../helpers/test-db';

afterEach(async () => {
  setSettings(DEFAULT_FACILITY_SETTINGS);
  await teardownTestDBs();
});

describe('facility settings live propagation', () => {
  test('saving the session facility updates synchronous and subscribed consumers immediately', async () => {
    const seen: string[] = [];
    const stop = subscribeSettings(settings => seen.push(settings.currency));

    await saveFacilitySettings('hospital-1', { currency: 'USD' }, 'org-1', 'hospital-1');

    stop();
    expect(getSettings().currency).toBe('USD');
    expect(seen).toContain('USD');
  });

  test('editing another facility does not overwrite the current session settings', async () => {
    await saveFacilitySettings('hospital-1', { currency: 'USD' }, 'org-1', 'hospital-1');
    await saveFacilitySettings('hospital-2', { currency: 'SSP' }, 'org-1', 'hospital-1');
    expect(getSettings().currency).toBe('USD');
  });
});
