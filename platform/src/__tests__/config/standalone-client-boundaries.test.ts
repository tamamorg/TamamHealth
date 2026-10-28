let standalone = true;
const apiFetch = jest.fn();

jest.mock('@/lib/sync/sync-config', () => ({
  isStandaloneDemoDeployment: () => standalone,
}));
jest.mock('@/lib/api-fetch', () => ({ apiFetch: (...args: unknown[]) => apiFetch(...args) }));
jest.mock('@/modules/identity/client', () => ({
  CSRF_COOKIE_NAME: 'csrf',
  CSRF_HEADER_NAME: 'x-csrf-token',
}));
jest.mock('@/lib/usage/posthog', () => ({
  captureUsageToPostHog: jest.fn(),
  isPostHogEnabled: () => false,
}));

import { persistUserPreferences } from '@/lib/settings/user-settings-sync';
import { flushUsageQueue, track } from '@/lib/usage/tracker';

describe('standalone browser/server boundaries', () => {
  beforeEach(() => {
    standalone = true;
    apiFetch.mockReset();
    localStorage.clear();
    window.history.replaceState({}, '', '/patients');
  });

  it('keeps preferences local without calling an API that has no database', async () => {
    await expect(persistUserPreferences('user-1', { theme: 'dark' })).resolves.toBe(true);
    expect(apiFetch).not.toHaveBeenCalled();
    expect(localStorage.getItem('tamamhealth.preferences.pending.user-1')).toBeNull();
  });

  it('does not enqueue or post product telemetry and clears an old queue', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({ ok: true } as Response);
    localStorage.setItem('tamamhealth_usage_queue', JSON.stringify([{ eventName: 'page_view' }]));

    track('page_view');
    await flushUsageQueue();

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(localStorage.getItem('tamamhealth_usage_queue')).toBe('[]');
    fetchSpy.mockRestore();
  });
});
