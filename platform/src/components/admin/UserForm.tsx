'use client';

/**
 * The staff-account form, shared by every surface that creates one.
 *
 * Same contract as `OrganizationForm`, and for the same reason: the fields,
 * the scope rules and the create call live in ONE component, and the host owns
 * only what happens after. `onCancel` for the cancel button, `onSaved` once the
 * account (and its invitation attempt) has finished — the host decides whether
 * that means closing a dialog or navigating back to the roster.
 *
 * The credential hand-off is deliberately NOT rendered here. The form unmounts
 * as its host navigates away, and a panel that shows a temporary password
 * exactly once must outlive the thing that produced it — so `onSaved` hands the
 * credentials up and the host displays them.
 */

import { useMemo, useState } from 'react';
import { Building2, Eye, EyeOff, RefreshCw, ShieldCheck } from '@/components/icons/lucide';
import Select from '@/components/Select';
import CreateFacilityModal from '@/components/admin/CreateFacilityModal';
import {
  generateTempPassword, roleNeedsFacility, roleNeedsOrganization,
  usePasswordPolicy, validateUserScope,
} from '@/modules/identity/client';
import type { InvitationOutcome } from '@/modules/identity/client';
import { canCreateFacilities } from '@/lib/people-nav';
import { activeFacilities } from '@/lib/services/hospital-service';
import { useHospitals } from '@/lib/hooks/useHospitals';
import { useOrganizations } from '@/lib/hooks/useOrganizations';
import { useApp } from '@/lib/context';
import { useTranslation } from '@/lib/i18n/useTranslation';
import type { UserDoc, UserRole } from '@/lib/db-types';

/** Credentials the host shows exactly once — see the note above. */
export interface UserCredentialHandoff {
  username: string;
  password: string;
  invitation?: InvitationOutcome;
}

/**
 * The form's sections, exported so a full-page host can build jump links from
 * the same list the form renders its anchors from — the rail and the sections
 * cannot drift apart if there is only one list.
 */
export const USER_FORM_SECTIONS = [
  { id: 'user-identity', labelKey: 'adminUsers.sectionIdentity' },
  { id: 'user-credentials', labelKey: 'adminUsers.sectionCredentials' },
  { id: 'user-scope', labelKey: 'adminUsers.sectionScope' },
] as const;

const ROLE_OPTIONS: UserRole[] = [
  'doctor', 'clinical_officer', 'nurse', 'midwife', 'lab_tech', 'pharmacist',
  'radiologist', 'nutritionist', 'front_desk', 'cashier', 'medical_biller',
  'data_entry_clerk', 'hrio', 'records_hmis_officer', 'medical_superintendent',
  'hospital_manager', 'org_admin', 'government', 'county_health_director',
  'central_registration_clerk', 'clinic_clerk', 'triage_nurse', 'rooming_nurse',
  'clinician',
];

const EMPTY = {
  name: '', username: '', email: '', password: '',
  role: 'nurse' as UserRole, orgId: '', hospitalId: '',
};

export function UserForm({ onCancel, onSaved }: {
  onCancel: () => void;
  /** Fires after the account exists. `handoff` carries the one-time password. */
  onSaved: (result: { user: UserDoc; handoff: UserCredentialHandoff }) => void;
}) {
  const { t } = useTranslation();
  const { currentUser } = useApp();
  const { hospitals } = useHospitals();
  const { organizations } = useOrganizations();
  const { minLength: MIN_PASSWORD_LENGTH, tempLength } = usePasswordPolicy();

  const [form, setForm] = useState(() => ({ ...EMPTY, password: generateTempPassword(tempLength) }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(true);
  const [showAddFacility, setShowAddFacility] = useState(false);

  const roleLabel = (role: string) => t(`adminUsers.role_${role}`);
  const needsOrg = roleNeedsOrganization(form.role);
  const needsFacility = roleNeedsFacility(form.role);

  const facilityChoices = useMemo(
    // Retired facilities keep their records and stay readable, but nothing new
    // is assigned to them — staffing a closed site is what retiring it stops.
    () => (form.orgId ? activeFacilities(hospitals.filter(h => h.orgId === form.orgId)) : []),
    [hospitals, form.orgId],
  );

  /**
   * Changing the role changes what scope is required, so a stale facility from
   * a previous selection must not ride along — an org_admin carrying a
   * hospitalId is exactly the mismatch the server strips server-side, and
   * leaving it in the form makes the screen disagree with what gets saved.
   */
  const changeRole = (role: UserRole) => {
    setError(null);
    setForm(f => ({ ...f, role, hospitalId: roleNeedsFacility(role) ? f.hospitalId : '' }));
  };

  const submit = async () => {
    if (!currentUser) return;
    if (!form.name.trim() || !form.username.trim() || !form.password) {
      setError(t('adminUsers.errorRequiredFields'));
      return;
    }
    if (form.password.length < MIN_PASSWORD_LENGTH) {
      setError(t('adminUsers.errorPasswordLength', { count: MIN_PASSWORD_LENGTH }));
      return;
    }
    // The organization and facility a role REQUIRES, checked with the same
    // rules /api/users enforces — otherwise the form cheerfully accepts
    // "Organization: none" for a facility-bound role and only surfaces it as a
    // 400 after everything has been typed, with the password lost on the way.
    const scopeError = validateUserScope({
      role: form.role, orgId: form.orgId, hospitalId: form.hospitalId,
    });
    if (scopeError) {
      setError(scopeError);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      // `createUserWithInvitation` is POST /api/users kept whole: the route
      // ALWAYS attempts an invitation and reports what happened, so the host
      // can tell the operator whether a link was mailed or a password must be
      // read out.
      const { createUserWithInvitation } = await import('@/modules/identity/services/user-service');
      const hospital = hospitals.find(h => h._id === form.hospitalId);
      const { user, invitation } = await createUserWithInvitation({
        name: form.name.trim(),
        username: form.username.trim(),
        email: form.email.trim() || undefined,
        password: form.password,
        role: form.role,
        orgId: form.orgId || undefined,
        hospitalId: form.hospitalId || undefined,
        hospitalName: hospital?.name,
      });
      onSaved({ user, handoff: { username: user.username, password: form.password, invitation } });
    } catch (err) {
      setError(err instanceof Error ? err.message : t('adminUsers.errorCreateFailed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div className="uf-form">
        <section id="user-identity" className="uf-section">
          <h3>{t('adminUsers.sectionIdentity')}</h3>
          <div className="uf-field">
            <span className="uf-label">{t('adminUsers.fieldFullName')}</span>
            <input
              type="text" className="uf-input" value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
            />
          </div>
          <div className="uf-field">
            <span className="uf-label">{t('adminUsers.fieldUsername')}</span>
            <input
              type="text" className="uf-input" value={form.username} autoComplete="off"
              onChange={e => setForm(f => ({ ...f, username: e.target.value }))}
            />
          </div>
          <div className="uf-field">
            <span className="uf-label">{t('adminUsers.fieldEmail')}</span>
            <input
              type="email" className="uf-input" value={form.email} autoComplete="off" data-field="user-email"
              onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
            />
            <small className="uf-hint">{t('adminUsers.fieldEmailHint')}</small>
          </div>
        </section>

        <section id="user-credentials" className="uf-section">
          <h3>{t('adminUsers.sectionCredentials')}</h3>
          <div className="uf-field">
            <span className="uf-labelrow">
              <span className="uf-label">{t('adminUsers.fieldTempPassword')}</span>
              <button
                type="button" className="uf-generate"
                onClick={() => { setForm(f => ({ ...f, password: generateTempPassword(tempLength) })); setShowPassword(true); }}
              >
                <RefreshCw className="w-3 h-3" /> {t('adminUsers.generate')}
              </button>
            </span>
            <span className="uf-passwrap">
              <input
                type={showPassword ? 'text' : 'password'}
                className="uf-input uf-input--pass"
                value={form.password}
                autoComplete="new-password"
                onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
              />
              <button
                type="button" className="uf-eye" onClick={() => setShowPassword(v => !v)}
                aria-label={t('adminUsers.togglePassword')}
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </span>
            <small className="uf-hint uf-hint--icon">
              <ShieldCheck className="w-3 h-3" /> {t('adminUsers.tempPasswordNote')}
            </small>
          </div>
        </section>

        <section id="user-scope" className="uf-section">
          <h3>{t('adminUsers.sectionScope')}</h3>
          <div className="uf-field">
            <span className="uf-label">{t('adminUsers.colRole')}</span>
            <Select value={form.role} onChange={e => changeRole(e.target.value as UserRole)} className="uf-input">
              {ROLE_OPTIONS.map(r => <option key={r} value={r}>{roleLabel(r)}</option>)}
            </Select>
          </div>
          <div className="uf-field">
            <span className="uf-label">{t('adminUsers.colOrganization')}{needsOrg ? ' *' : ''}</span>
            <Select
              value={form.orgId} className="uf-input"
              onChange={e => setForm(f => ({ ...f, orgId: e.target.value, hospitalId: '' }))}
            >
              {/* "None" is only an option for the platform and national roles
                  that genuinely have no tenant — offering it to a facility role
                  is how an unscoped account gets made. */}
              <option value="">
                {needsOrg ? t('adminUsers.selectOrganization') : t('adminUsers.noOrganization')}
              </option>
              {organizations.map(o => <option key={o._id} value={o._id}>{o.name}</option>)}
            </Select>
          </div>
          {/* Organisation-wide roles (org_admin, government, county health
              director) are not bound to a facility, so the picker is not shown
              for them at all rather than shown and ignored. */}
          {needsFacility && (
            <div className="uf-field">
              <span className="uf-label">{t('adminUsers.colHospital')} *</span>
              {facilityChoices.length > 0 ? (
                <Select
                  value={form.hospitalId} className="uf-input"
                  onChange={e => setForm(f => ({ ...f, hospitalId: e.target.value }))}
                >
                  <option value="">{t('adminUsers.selectFacility')}</option>
                  {facilityChoices.map(h => <option key={h._id} value={h._id}>{h.name}</option>)}
                </Select>
              ) : (
                <div className="uf-nofacility" data-field="no-facilities">
                  <p>{form.orgId ? t('adminUsers.orgHasNoFacilities') : t('adminUsers.selectOrgFirst')}</p>
                  {form.orgId && (
                    <>
                      <p>{t('adminUsers.facilityRequiredFor', { role: roleLabel(form.role).toLowerCase() })}</p>
                      {canCreateFacilities(currentUser?.role ?? '') && (
                        <button
                          type="button" className="btn btn-secondary btn-sm"
                          onClick={() => setShowAddFacility(true)}
                          data-action="add-facility-inline"
                        >
                          <Building2 className="w-4 h-4" /> {t('adminUsers.addAFacility')}
                        </button>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
          )}
        </section>

        {error && <p className="uf-error" role="alert">{error}</p>}

        <div className="uf-actions">
          <button type="button" className="btn btn-secondary btn-sm" onClick={onCancel} disabled={saving}>
            {t('action.cancel')}
          </button>
          <button type="button" className="btn btn-primary btn-sm" onClick={submit} disabled={saving}>
            {saving ? t('adminUsers.creating') : t('adminUsers.createUser')}
          </button>
        </div>
      </div>

      {/* Registering a facility without losing the half-filled account. */}
      {showAddFacility && canCreateFacilities(currentUser?.role ?? '') && (
        <CreateFacilityModal
          orgId={form.orgId}
          onClose={() => setShowAddFacility(false)}
          onCreated={hospital => {
            setShowAddFacility(false);
            setForm(f => ({ ...f, hospitalId: hospital._id }));
          }}
        />
      )}
    </>
  );
}
