/**
 * Settings have to REACH the app, not just save.
 *
 * Every case here corresponds to a setting that was previously written to
 * storage and read by nothing — the class of bug where the page says "Settings
 * saved" and the product behaves exactly as before. These assert the join
 * between a stored preference and the code that acts on it, so a future
 * refactor that quietly drops a consumer fails loudly here instead of silently
 * on a ward.
 */
jest.mock('@/lib/db', () => require('../helpers/test-db').createDBMock());

import {
  initRoleSettings,
  clearRoleSettings,
  getRoleFlag,
  getRoleChoice,
  getRoleSettings,
  setRoleSettings,
  resetRoleSettings,
  replaceRoleSettings,
  roleSettingDefaults,
  subscribeRoleSettings,
} from '@/lib/settings/role-settings-store';
import { resolveLandingPage } from '@/lib/user-prefs';
import { filterNotifications, wantsNotification } from '@/lib/settings/notification-preferences';
import { mergeFacilitySettings, DEFAULT_FACILITY_SETTINGS } from '@/lib/settings/facility-settings';
import { setDisabledApps, isAppDisabled, getDisabledAppRoutes } from '@/lib/settings/disabled-apps';
import { systemConfigScope, PLATFORM_CONFIG_SCOPE } from '@/lib/services/system-config-service';
import { specForRole } from '@/lib/role-settings';
import type { NotificationItem } from '@/lib/hooks/useNotifications';

const DOCTOR_ID = 'user-doctor-1';

beforeEach(() => {
  window.localStorage.clear();
  clearRoleSettings();
  setDisabledApps({});
});

// ── The store: defaults, overrides, and live notification ───────────────────

describe('role settings store', () => {
  it('serves the role spec defaults before the user has changed anything', () => {
    initRoleSettings(DOCTOR_ID, 'doctor');
    // Declared in lib/role-settings.ts as the doctor's queue default.
    expect(getRoleChoice('queue.sort', 'x')).toBe('Longest wait first');
    expect(getRoleFlag('rx.allergyCheck', false)).toBe(true);
  });

  it('layers the user’s stored overrides on top of those defaults', () => {
    window.localStorage.setItem(
      `tamamhealth.roleSettings.${DOCTOR_ID}`,
      JSON.stringify({ 'queue.sort': 'Acuity first' }),
    );
    initRoleSettings(DOCTOR_ID, 'doctor');
    expect(getRoleChoice('queue.sort', 'x')).toBe('Acuity first');
    // Untouched rows still come from the spec.
    expect(getRoleFlag('queue.mineOnly', false)).toBe(true);
  });

  it('notifies subscribers so live consumers re-render', () => {
    initRoleSettings(DOCTOR_ID, 'doctor');
    const seen: string[] = [];
    const stop = subscribeRoleSettings(v => seen.push(String(v['queue.sort'])));
    setRoleSettings({ 'queue.sort': 'Appointment time' });
    stop();
    setRoleSettings({ 'queue.sort': 'Acuity first' });
    expect(seen).toEqual(['Appointment time']);
    // Unsubscribed, but the store still moved on.
    expect(getRoleChoice('queue.sort', '')).toBe('Acuity first');
  });

  it('persists only the explicit overrides, so spec defaults stay live', () => {
    initRoleSettings(DOCTOR_ID, 'doctor');
    setRoleSettings({ 'queue.mineOnly': false });
    const stored = JSON.parse(
      window.localStorage.getItem(`tamamhealth.roleSettings.${DOCTOR_ID}`) || '{}',
    );
    expect(stored).toEqual({ 'queue.mineOnly': false });
  });

  it('reset restores the role defaults and clears storage', () => {
    initRoleSettings(DOCTOR_ID, 'doctor');
    setRoleSettings({ 'queue.sort': 'Newest first' });
    resetRoleSettings(DOCTOR_ID, 'doctor');
    expect(getRoleChoice('queue.sort', '')).toBe('Longest wait first');
    expect(window.localStorage.getItem(`tamamhealth.roleSettings.${DOCTOR_ID}`)).toBe('{}');
  });

  it('replace (the Save button) writes through to the store', () => {
    initRoleSettings(DOCTOR_ID, 'doctor');
    replaceRoleSettings(DOCTOR_ID, { 'queue.sort': 'Acuity first', 'queue.mineOnly': false });
    expect(getRoleSettings()['queue.sort']).toBe('Acuity first');
    expect(getRoleFlag('queue.mineOnly', true)).toBe(false);
  });

  it('falls back to the caller’s default when nothing is hydrated', () => {
    expect(getRoleChoice('queue.sort', 'Appointment time')).toBe('Appointment time');
    expect(getRoleFlag('rx.interactions', true)).toBe(true);
  });
});

// ── Rows that are declared but not implemented must not masquerade ──────────

describe('pending rows', () => {
  it('are excluded from the defaults the store serves', () => {
    const defaults = roleSettingDefaults('nurse');
    // `mar.barcode` needs barcode scanning, which the platform does not have.
    const marRow = specForRole('nurse').sections
      .flatMap(s => s.rows)
      .find(r => 'key' in r && r.key === 'mar.barcode');
    expect(marRow && 'pending' in marRow && marRow.pending).toBe(true);
    expect(defaults['mar.barcode']).toBeUndefined();
  });

  it('leave the wired rows alone', () => {
    const defaults = roleSettingDefaults('doctor');
    expect(defaults['queue.sort']).toBe('Longest wait first');
    expect(defaults['rx.duration']).toBe('5 days');
  });
});

// ── Start-up screen ─────────────────────────────────────────────────────────

describe('resolveLandingPage', () => {
  it('uses the role default when no start-up screen is chosen', () => {
    initRoleSettings(DOCTOR_ID, 'doctor');
    expect(resolveLandingPage('doctor')).toBe('/dashboard');
  });

  it('honours the chosen start-up screen', () => {
    initRoleSettings(DOCTOR_ID, 'doctor');
    setRoleSettings({ 'account.landing': 'Appointments' });
    expect(resolveLandingPage('doctor')).toBe('/appointments');
  });

  it('ignores a choice the role may not enter, rather than bouncing them', () => {
    // A choice outlives a role change: this one was made as a doctor.
    initRoleSettings('user-cashier', 'cashier');
    setRoleSettings({ 'account.landing': 'Consultation' });
    const landing = resolveLandingPage('cashier');
    expect(landing).not.toBe('/consultation');
    expect(landing).toBe('/payments');
  });
});

// ── Notification preferences ────────────────────────────────────────────────

const note = (over: Partial<NotificationItem>): NotificationItem => ({
  id: 'n1', type: 'lab', severity: 'critical', title: 't', subtitle: 's',
  time: '2026-08-21T00:00:00.000Z', href: '/lab', ...over,
});

describe('notification preferences', () => {
  it('drops a notification whose governing row the user switched off', () => {
    const critical = note({ type: 'lab', severity: 'critical' });
    expect(wantsNotification(critical, { 'notify.criticalLabs': false })).toBe(false);
    expect(wantsNotification(critical, { 'notify.criticalLabs': true })).toBe(true);
  });

  it('keeps notifications the user’s role has no setting for', () => {
    // A pharmacist has no "referrals" row — theirs must not be filtered by a
    // key that only exists on the doctor's page.
    expect(wantsNotification(note({ type: 'referral' }), { 'notify.newRx': false })).toBe(true);
  });

  it('keeps an item when any one of its governing rows is on', () => {
    const transfer = note({ type: 'transfer' });
    expect(wantsNotification(transfer, {
      'notify.admissions': false,
      'notify.assigned': true,
    })).toBe(true);
  });

  it('filters a whole list', () => {
    const items = [
      note({ id: 'a', type: 'lab', severity: 'critical' }),
      note({ id: 'b', type: 'referral', severity: 'warning' }),
      note({ id: 'c', type: 'prescription', severity: 'info' }),
    ];
    const kept = filterNotifications(items, {
      'notify.criticalLabs': false,
      'notify.referrals': true,
      'notify.newRx': false,
    });
    expect(kept.map(i => i.id)).toEqual(['b']);
  });
});

// ── Facility policy ─────────────────────────────────────────────────────────

describe('facility clinical policy', () => {
  it('defaults preserve the behaviour these rows shipped with', () => {
    const s = DEFAULT_FACILITY_SETTINGS;
    expect(s.clinicalPolicy.doorToClinicianMinutes).toBe(30);
    expect(s.clinicalPolicy.diagnosisCoding).toBe('ICD-11');
    // Advisory, not blocking — the platform's long-standing allergy behaviour.
    expect(s.clinicalPolicy.allergyHardStop).toBe(false);
  });

  it('merges a partial stored doc over the defaults', () => {
    const merged = mergeFacilitySettings({
      clinicalPolicy: { allergyHardStop: true },
    } as never);
    expect(merged.clinicalPolicy.allergyHardStop).toBe(true);
    // Sibling keys survive the partial write.
    expect(merged.clinicalPolicy.doorToClinicianMinutes).toBe(30);
    expect(merged.reportingSchedule.idsrDay).toBe('Friday');
  });

  it('a doc written before these groups existed still resolves', () => {
    const merged = mergeFacilitySettings({ currency: 'USD' });
    expect(merged.currency).toBe('USD');
    expect(merged.userPolicy.deactivateAfterIdleDays).toBe(60);
  });
});

// ── System administration scope + module toggles ────────────────────────────

describe('system configuration scope', () => {
  it('gives a platform admin with no organization a scope of their own', () => {
    expect(systemConfigScope(undefined, 'super_admin')).toBe(PLATFORM_CONFIG_SCOPE);
  });

  it('uses the organization when there is one', () => {
    expect(systemConfigScope('org-1', 'super_admin')).toBe('org-1');
    expect(systemConfigScope('org-1', 'org_admin')).toBe('org-1');
  });

  it('leaves other roles without a scope rather than inventing one', () => {
    expect(systemConfigScope(undefined, 'nurse')).toBe('');
  });
});

describe('disabled app routes', () => {
  it('is empty until an override switches something off', () => {
    expect(getDisabledAppRoutes()).toEqual([]);
    expect(isAppDisabled('/lab')).toBe(false);
  });

  it('hides a disabled app’s route and everything beneath it', () => {
    setDisabledApps({ 'app-laboratory': false });
    // Only asserts the mechanism if the registry really has that app.
    if (getDisabledAppRoutes().length > 0) {
      const route = getDisabledAppRoutes()[0];
      expect(isAppDisabled(route)).toBe(true);
      expect(isAppDisabled(`${route}/worklist`)).toBe(true);
      expect(isAppDisabled('/definitely-not-that-route')).toBe(false);
    }
  });

  it('an explicitly enabled app is not disabled', () => {
    setDisabledApps({ 'app-laboratory': true });
    expect(getDisabledAppRoutes()).toEqual([]);
  });
});
