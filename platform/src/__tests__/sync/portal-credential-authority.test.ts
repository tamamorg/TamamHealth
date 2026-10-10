/**
 * Patient-portal credentials on a patient document are the server's to write.
 *
 * The attack this closes: any role that can write a patient (a nurse, a
 * data-entry clerk, a stolen device) writes the hash of an activation code it
 * chose onto an existing patient, lets it replicate, redeems the code at the
 * unauthenticated activation endpoint, and owns that patient's portal account.
 * The rule must stop that without refusing the ordinary case it resembles — a
 * device editing a patient while holding a copy from before they activated.
 */
import { PORTAL_ENROL_ROLES, applyPortalCredentialAuthority, canIssuePortalInvite } from '@/lib/sync/portal-credential-authority';
import { DOC_WRITE_ROLES } from '@/lib/sync/write-permissions';

const base = { _id: 'pat-1', type: 'patient', orgId: 'org-a', firstName: 'Mary', phone: '0911' };
const activated = {
  ...base, portalUsername: 'mary.deng.0042', portalPasswordHash: 'server-hash',
  portalEnabledAt: '2026-10-01', portalLastLoginAt: '2026-10-07',
};

describe('an existing patient: the server’s portal fields stand', () => {
  test('a planted activation code is discarded, the rest of the edit is kept', () => {
    const attack = { ...activated, phone: '0922', portalInviteTokenHash: 'attacker-hash', portalInviteExpiresAt: '2099-01-01' };
    const { doc, changed } = applyPortalCredentialAuthority(attack, activated, 'nurse');
    expect(changed).toBe(true);
    expect(doc.portalInviteTokenHash).toBeUndefined();
    expect(doc.portalPasswordHash).toBe('server-hash');
    expect(doc.phone).toBe('0922');
  });

  test('a device cannot overwrite the password or lift a suspension — whatever its role', () => {
    const suspended = { ...activated, portalDisabledAt: '2026-10-08' };
    const attack = { ...activated, portalPasswordHash: 'attacker-hash' }; // also drops portalDisabledAt
    for (const role of ['nurse', 'front_desk', 'org_admin']) {
      const { doc } = applyPortalCredentialAuthority(attack, suspended, role);
      expect(doc.portalPasswordHash).toBe('server-hash');
      expect(doc.portalDisabledAt).toBe('2026-10-08');
    }
  });

  test('a stale copy from before activation keeps its edit and gains the server’s fields', () => {
    const stale = { ...base, phone: '0933', portalUsername: 'mary.deng.0042', portalInviteTokenHash: 'old-invite' };
    const { doc, changed } = applyPortalCredentialAuthority(stale, activated, 'front_desk');
    expect(changed).toBe(true);
    expect(doc).toMatchObject({ phone: '0933', portalPasswordHash: 'server-hash', portalLastLoginAt: '2026-10-07' });
    expect(doc.portalInviteTokenHash).toBeUndefined();
  });

  test('a write that already agrees with the server is passed through untouched', () => {
    const edit = { ...activated, phone: '0944' };
    const result = applyPortalCredentialAuthority(edit, activated, 'nurse');
    expect(result.changed).toBe(false);
    expect(result.doc).toBe(edit);
  });
});

describe('a new patient: registration may issue an invitation, nothing more', () => {
  const invited = {
    ...base, portalUsername: 'mary.deng.0042', portalEnabledAt: '2026-10-08', portalEnabledBy: 'user-desk',
    portalInviteTokenHash: 'invite-hash', portalInviteExpiresAt: '2026-10-22',
  };

  test('an enrol role’s invitation is kept', () => {
    expect(applyPortalCredentialAuthority(invited, null, 'front_desk')).toEqual({ doc: invited, changed: false });
  });

  test('a clinical role that registers the patient issues the invitation too', () => {
    for (const role of ['nurse', 'doctor', 'clinical_officer', 'midwife']) {
      const { doc, changed } = applyPortalCredentialAuthority(invited, null, role);
      expect(changed).toBe(false);
      expect(doc.portalInviteTokenHash).toBe(invited.portalInviteTokenHash);
    }
  });

  test('a role that cannot register patients cannot create one with portal access', () => {
    for (const role of ['pharmacist', 'lab_tech', undefined]) {
      const { doc, changed } = applyPortalCredentialAuthority(invited, null, role);
      expect(changed).toBe(true);
      expect(Object.keys(doc).filter(key => key.startsWith('portal'))).toEqual([]);
    }
  });

  test('nobody can register a patient with a ready-made password or a login history', () => {
    const preset = { ...invited, portalPasswordHash: 'attacker-hash', portalLastLoginAt: '2026-10-08' };
    const { doc } = applyPortalCredentialAuthority(preset, null, 'org_admin');
    expect(doc.portalPasswordHash).toBeUndefined();
    expect(doc.portalLastLoginAt).toBeUndefined();
    expect(doc.portalInviteTokenHash).toBe('invite-hash');
  });
});

test('other document types and tombstones are left alone', () => {
  const appointment = { _id: 'a1', type: 'appointment', portalUsername: 'x' };
  expect(applyPortalCredentialAuthority(appointment, null, 'nurse').changed).toBe(false);
  expect(applyPortalCredentialAuthority({ ...activated, _deleted: true }, activated, 'nurse').changed).toBe(false);
});

test('re-issuing from a chart stays with desk and records roles', () => {
  expect(PORTAL_ENROL_ROLES).not.toContain('nurse');
  expect(PORTAL_ENROL_ROLES).not.toContain('doctor');
});

describe('the registration form and the gateway agree on who issues an invitation', () => {
  const invited = {
    ...base, portalUsername: 'mary.deng.0042', portalEnabledAt: '2026-10-10',
    portalInviteTokenHash: 'desk-hash', portalInviteExpiresAt: '2026-10-24',
  };

  // The form offers the account exactly when `canIssuePortalInvite` says so.
  // A role it said yes to and the gateway then stripped is a slip that never
  // activates, so every role that can register must have its invitation kept.
  test.each(DOC_WRITE_ROLES.patient.map(role => [role]))('%s', role => {
    expect(canIssuePortalInvite(role)).toBe(true);
    expect(applyPortalCredentialAuthority(invited, null, role).doc.portalInviteTokenHash).toBe('desk-hash');
  });

  test('no role, no offer', () => {
    expect(canIssuePortalInvite(undefined)).toBe(false);
    expect(canIssuePortalInvite('')).toBe(false);
  });
});
