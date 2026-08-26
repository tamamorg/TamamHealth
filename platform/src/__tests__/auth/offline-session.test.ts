import {
  clearOfflineSession,
  readOfflineSession,
  startOfflineSession,
} from '@/modules/identity/core/offline-session';

const CLAIMS = {
  _id: 'user-1',
  username: 'clinician.one',
  name: 'Clinician One',
  role: 'doctor' as const,
  hospitalId: 'facility-1',
  orgId: 'org-1',
};

describe('browser-only offline session', () => {
  beforeEach(() => {
    sessionStorage.clear();
    jest.useRealTimers();
  });

  it('survives a page reload in the same tab without creating a cookie', () => {
    startOfflineSession(CLAIMS);
    expect(readOfflineSession()).toEqual(CLAIMS);
    expect(document.cookie).not.toContain('tamamhealth-token');
  });

  it('is removed explicitly on logout', () => {
    startOfflineSession(CLAIMS);
    clearOfflineSession();
    expect(readOfflineSession()).toBeNull();
  });

  it('rejects expired or malformed session state', () => {
    sessionStorage.setItem('tamamhealth.offline-session.v1', JSON.stringify({
      claims: CLAIMS,
      createdAt: '2026-08-25T00:00:00.000Z',
      expiresAt: '2026-08-25T08:00:00.000Z',
    }));
    expect(readOfflineSession()).toBeNull();

    sessionStorage.setItem('tamamhealth.offline-session.v1', '{bad json');
    expect(readOfflineSession()).toBeNull();
  });
});
