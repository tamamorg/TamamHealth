/**
 * @jest-environment node
 *
 * Pure logic behind "create an administrator for this organization" on
 * Super-admin → Organizations (src/lib/org-admin-provisioning.ts). The React
 * page wires this to the org-create submit handler; this suite covers the
 * validation and payload-shaping decisions in isolation, before any write
 * happens.
 */
import {
  validateOrgAdminForm,
  buildOrgAdminUserPayload,
  ORG_ADMIN_MIN_PASSWORD_LENGTH,
  emptyOrgAdminForm,
  type OrgAdminFormData,
} from '@/modules/identity/provisioning/org-admin-provisioning';

const form = (over: Partial<OrgAdminFormData> = {}): OrgAdminFormData => ({
  name: 'Grace Ayen',
  username: 'grace.ayen',
  email: '',
  password: 'CorrectHorse1',
  ...over,
});

describe('validateOrgAdminForm', () => {
  it('accepts a fully filled-in form', () => {
    expect(validateOrgAdminForm(form())).toBeNull();
  });

  it('rejects a blank name', () => {
    expect(validateOrgAdminForm(form({ name: '' }))).toBe('required');
  });

  it('rejects a name that is only whitespace', () => {
    expect(validateOrgAdminForm(form({ name: '   ' }))).toBe('required');
  });

  it('rejects a blank username', () => {
    expect(validateOrgAdminForm(form({ username: '' }))).toBe('required');
  });

  it('rejects a blank password', () => {
    expect(validateOrgAdminForm(form({ password: '' }))).toBe('required');
  });

  it('does NOT require an email — createUser() treats it as optional', () => {
    expect(validateOrgAdminForm(form({ email: '' }))).toBeNull();
  });

  it('rejects a password shorter than the minimum', () => {
    const short = 'a'.repeat(ORG_ADMIN_MIN_PASSWORD_LENGTH - 1);
    expect(validateOrgAdminForm(form({ password: short }))).toBe('password-too-short');
  });

  it('accepts a password exactly at the minimum length', () => {
    const exact = 'a'.repeat(ORG_ADMIN_MIN_PASSWORD_LENGTH);
    expect(validateOrgAdminForm(form({ password: exact }))).toBeNull();
  });

  it('the empty form fails required (used as the reset/default state)', () => {
    expect(validateOrgAdminForm(emptyOrgAdminForm)).toBe('required');
  });
});

describe('buildOrgAdminUserPayload', () => {
  it('always fixes role to org_admin, regardless of form contents', () => {
    const payload = buildOrgAdminUserPayload(form(), 'org-mercy');
    expect(payload.role).toBe('org_admin');
  });

  it('scopes the payload to the organization id that was just created', () => {
    const payload = buildOrgAdminUserPayload(form(), 'org-mercy');
    expect(payload.orgId).toBe('org-mercy');
  });

  it('trims name and username', () => {
    const payload = buildOrgAdminUserPayload(form({ name: '  Grace Ayen  ', username: '  grace.ayen  ' }), 'org-1');
    expect(payload.name).toBe('Grace Ayen');
    expect(payload.username).toBe('grace.ayen');
  });

  it('passes the password through verbatim (no client-side hashing)', () => {
    const payload = buildOrgAdminUserPayload(form({ password: 'SuperSecret123' }), 'org-1');
    expect(payload.password).toBe('SuperSecret123');
  });

  it('omits email when left blank rather than sending an empty string', () => {
    const payload = buildOrgAdminUserPayload(form({ email: '   ' }), 'org-1');
    expect(payload.email).toBeUndefined();
  });

  it('trims and includes email when provided', () => {
    const payload = buildOrgAdminUserPayload(form({ email: '  grace@example.org  ' }), 'org-1');
    expect(payload.email).toBe('grace@example.org');
  });
});
