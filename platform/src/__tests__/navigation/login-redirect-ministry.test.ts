/**
 * The Ministry of Health account (role `government`) must land on the national
 * dashboard, and the sign-in redirect screen must never spin forever.
 */
jest.mock('@/lib/db', () => require('../helpers/test-db').createDBMock());

import { getDefaultDashboard, isPathAllowed } from '@/lib/role-routes';
import { resolveLandingPage } from '@/lib/user-prefs';
import { clearRoleSettings, initRoleSettings } from '@/lib/settings/role-settings-store';
import {
  recordRedirectAttempt, resolveNextPath, REDIRECT_LOOP_LIMIT, REDIRECT_LOOP_WINDOW_MS,
} from '@/lib/navigation/login-redirect';

function memoryStore() {
  const data = new Map<string, string>();
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => { data.set(k, v); },
  };
}

describe('Ministry of Health landing', () => {
  beforeEach(() => {
    window.localStorage.clear();
    clearRoleSettings();
  });

  it('lands on /government and the role may open it', () => {
    initRoleSettings('user-admin', 'government');
    expect(getDefaultDashboard('government')).toBe('/government');
    expect(isPathAllowed('government', '/government')).toBe(true);
    expect(resolveLandingPage('government')).toBe('/government');
  });

  it('never accepts the sign-in screen as a ?next= target', () => {
    expect(resolveNextPath('/login', 'government')).toBeNull();
    expect(resolveNextPath('/login?next=/government', 'super_admin')).toBeNull();
    expect(resolveNextPath('/government', 'government')).toBe('/government');
  });
});

describe('redirect fail-safe', () => {
  it('flags a loop after repeated bounces inside the window', () => {
    const store = memoryStore();
    let result = { attempts: 0, looping: false };
    for (let i = 0; i < REDIRECT_LOOP_LIMIT; i++) result = recordRedirectAttempt(store, 1000 + i);
    expect(result.looping).toBe(false);
    expect(recordRedirectAttempt(store, 2000).looping).toBe(true);
  });

  it('forgets attempts older than the window and survives bad storage', () => {
    const store = memoryStore();
    for (let i = 0; i < 5; i++) recordRedirectAttempt(store, 1000 + i);
    expect(recordRedirectAttempt(store, 1000 + REDIRECT_LOOP_WINDOW_MS + 10).attempts).toBe(1);
    expect(recordRedirectAttempt(null).looping).toBe(false);
    store.setItem('tamamhealth.login-redirect-attempts', '{not json');
    expect(recordRedirectAttempt(store, 5).attempts).toBe(1);
  });
});
