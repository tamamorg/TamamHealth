'use client';

/**
 * The one dialog that creates a staff account.
 *
 * It was written inline on /org-admin/users, which meant a facility had no way
 * to add its own people: an admin standing in a hospital's Staff tab had to
 * leave for the org roster, open the create form there, and pick the facility
 * they had just been looking at out of a dropdown. Lifting the form out of that
 * page lets the facility profile open the same dialog with the facility already
 * chosen and locked — same validation, same provisioning call, same credential
 * hand-off — instead of a second, drifting copy of the form.
 *
 * The caller owns what happens after: `onCreated` receives the credentials so
 * the page can show the hand-off modal and reload its own list.
 */

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useApp } from '@/lib/context';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { Eye, EyeOff, RefreshCw, ShieldCheck, Building2 } from '@/components/icons/lucide';
import Modal from '@/components/Modal';
import Select from '@/components/Select';
import { generateTempPassword } from '@/modules/identity/provisioning/temp-password';
import { canCreateFacilities } from '@/lib/people-nav';
import { roleNeedsFacility } from '@/modules/identity/policy/user-scope-rules';
import { getRoleConfig, labelRolesDistinctly, assignableRolesForOrgAdmin } from '@/lib/permissions';
import type { InvitationOutcome } from '@/modules/identity/provisioning/user-invite';
import type { HospitalDoc, UserRole } from '@/lib/db-types';

import { usePasswordPolicy } from '@/modules/identity/hooks/usePasswordPolicy';

/** What the caller needs to hand the new account to its owner. */
export interface CreatedCredentials {
  username: string;
  password: string;
  invitation?: InvitationOutcome;
}

export default function CreateUserModal({
  hospitals,
  presetHospitalId,
  lockFacility = false,
  onClose,
  onCreated,
  onAddFacility,
}: {
  /** Facilities the picker may offer. */
  hospitals: HospitalDoc[];
  /** Facility to start on — the facility whose Staff tab opened the dialog. */
  presetHospitalId?: string;
  /** Opened from inside a facility: show the facility, don't offer a choice. */
  lockFacility?: boolean;
  onClose: () => void;
  onCreated: (credentials: CreatedCredentials) => void | Promise<void>;
  /** Register the org's first facility without discarding this half-filled
   *  form. Callers that can't open a facility dialog leave this off and the
   *  fallback routes to /hospitals. */
  onAddFacility?: () => void;
}) {
  const { t } = useTranslation();
  const { currentUser } = useApp();
  const router = useRouter();

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState(() => generateTempPassword());
  // Hidden by default. This dialog is used at a shared desk in a clinic, often
  // with the next person already standing there, and the credential sat on
  // screen for the whole length of the form. The eye toggle is still one tap
  // away for the case this exists to serve — reading it aloud to someone with
  // no email address.
  const [showPassword, setShowPassword] = useState(false);
  const [role, setRole] = useState<UserRole>('doctor');
  const [hospitalId, setHospitalId] = useState(presetHospitalId || '');
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  // The minimum this deployment enforces (Security settings → Password
  // minimum). Hard-coding 8 here meant the dialog accepted passwords the
  // server then refused, which reads as a broken form rather than a policy.
  const { minLength: minPasswordLength, tempLength } = usePasswordPolicy();

  // A facility opened this: keep the field pointing at it even if the caller
  // re-renders with a different facility selected.
  useEffect(() => {
    if (presetHospitalId) setHospitalId(presetHospitalId);
  }, [presetHospitalId]);

  // `enabledRoles` is the roster the platform super-admin picked for this
  // organization (Organizations → Staff roles). Absent narrows nothing.
  const availableRoles = useMemo(
    () => assignableRolesForOrgAdmin(
      currentUser?.organization?.orgType,
      currentUser?.organization?.enabledRoles,
    ),
    [currentUser?.organization?.orgType, currentUser?.organization?.enabledRoles],
  );

  const roleLabel = (r: string) => {
    const map: Record<string, string> = {
      super_admin: t('orgUsers.roleSuperAdmin'),
      org_admin: t('orgUsers.roleOrgAdmin'),
      doctor: t('orgUsers.roleDoctor'),
      clinical_officer: t('orgUsers.roleClinicalOfficer'),
      nurse: t('orgUsers.roleNurse'),
      lab_tech: t('orgUsers.roleLabTech'),
      pharmacist: t('orgUsers.rolePharmacist'),
      front_desk: t('orgUsers.roleFrontDesk'),
      government: t('orgUsers.roleGovernment'),
      data_entry_clerk: t('orgUsers.roleDataEntryClerk'),
      medical_superintendent: t('orgUsers.roleMedicalSuperintendent'),
      hrio: t('orgUsers.roleHrio'),
      nutritionist: t('orgUsers.roleNutritionist'),
      radiologist: t('orgUsers.roleRadiologist'),
      hospital_manager: t('orgUsers.roleHospitalManager'),
      medical_biller: t('orgUsers.roleMedicalBiller'),
    };
    // The map is translated but partial — ROLE_PERMISSIONS carries a written
    // label for every role, so use it before falling back to the identifier.
    return map[r] || getRoleConfig(r as UserRole)?.label || r;
  };

  // `doctor` and `clinician` share the label "Doctor"; labelRolesDistinctly
  // appends the identifier to just those.
  const roleOptions = labelRolesDistinctly(availableRoles).map(({ role: r, label }) => ({
    role: r,
    label: label.includes('(') ? label : roleLabel(r),
  }));

  // Keep the picked role inside what this organization actually allows. The
  // default 'doctor' is not assignable everywhere.
  useEffect(() => {
    if (availableRoles.length && !availableRoles.includes(role)) setRole(availableRoles[0]);
  }, [availableRoles, role]);

  // The facility requirement is `lib/user-scope-rules.ts`'s to state.
  const needsHospital = roleNeedsFacility(role);
  const lockedHospital = lockFacility && presetHospitalId
    ? hospitals.find(h => h._id === presetHospitalId)
    : undefined;

  const inputStyle: React.CSSProperties = {
    background: 'var(--overlay-subtle)', border: '1px solid var(--border-light)',
    borderRadius: '4px', padding: '10px 14px', color: 'var(--text-primary)',
    fontSize: '14px', width: '100%', outline: 'none',
  };
  // No custom chevron artwork here — the global `select` rule already draws
  // one (globals.css); this only reserves room for it.
  const selectStyle: React.CSSProperties = { ...inputStyle, paddingInlineEnd: 40 };

  const handleCreate = async () => {
    setError('');
    if (!username.trim() || !password.trim() || !name.trim()) {
      setError(t('orgUsers.errorRequiredFields'));
      return;
    }
    if (needsHospital && !hospitalId) {
      setError(t('orgUsers.errorSelectHospital'));
      return;
    }
    if (password.length < minPasswordLength) {
      setError(t('orgUsers.errorPasswordLength'));
      return;
    }

    setCreating(true);
    try {
      const { createUserWithInvitation } = await import('@/modules/identity/services/user-service');
      const selectedHospital = hospitals.find(h => h._id === hospitalId);
      const newUsername = username.trim().toLowerCase();
      const tempPassword = password;
      const { invitation } = await createUserWithInvitation({
        username: newUsername,
        password: tempPassword,
        name: name.trim(),
        role,
        hospitalId: needsHospital ? hospitalId : undefined,
        hospitalName: needsHospital ? selectedHospital?.name : undefined,
        // A facility carries the org that owns it; a platform operator adding
        // staff to a tenant's facility must not stamp their own (absent) org.
        orgId: selectedHospital?.orgId ?? currentUser?.orgId,
        email: email.trim() || undefined,
      });
      // The password is unrecoverable after this — hand it to the caller
      // before anything can unmount the dialog.
      await onCreated({ username: newUsername, password: tempPassword, invitation });
    } catch (err: unknown) {
      const e = err as Error;
      setError(e.message || t('orgUsers.errorCreateFailed'));
    } finally {
      setCreating(false);
    }
  };

  return (
    <Modal onClose={onClose} width={440} labelledBy="create-user-title">
      <div className="sadb-modal">
        <div className="sadb-modal-copy">
          <h2 id="create-user-title" className="sadb-modal-title">{t('orgUsers.createNewUser')}</h2>
          {lockedHospital && (
            <p className="sadb-modal-sub">{t('hospitals.addUserForFacility', { name: lockedHospital.name })}</p>
          )}
        </div>
        <div className="space-y-3">
          {/* Name */}
          <div>
            <label className="text-xs font-semibold block mb-1.5" style={{ color: 'var(--text-muted)' }}>{t('orgUsers.fieldFullName')}</label>
            <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder={t('orgUsers.fullNamePlaceholder')} style={inputStyle} />
          </div>

          {/* Email — optional. Present means the new user gets an invitation
              link and chooses their own password; absent means the admin
              reads them the temporary one. */}
          <div>
            <label className="text-xs font-semibold block mb-1.5" style={{ color: 'var(--text-muted)' }}>{t('orgUsers.fieldEmail')}</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder={t('orgUsers.emailPlaceholder')} style={inputStyle} autoComplete="off" />
            <p className="mt-1 text-[11px]" style={{ color: 'var(--text-muted)' }}>
              {t('orgUsers.emailHint')}
            </p>
          </div>

          {/* Username */}
          <div>
            <label className="text-xs font-semibold block mb-1.5" style={{ color: 'var(--text-muted)' }}>{t('orgUsers.fieldUsername')}</label>
            <input type="text" value={username} onChange={e => setUsername(e.target.value)} placeholder={t('orgUsers.usernamePlaceholder')} style={inputStyle} autoComplete="off" />
          </div>

          {/* Password */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-semibold block" style={{ color: 'var(--text-muted)' }}>{t('orgUsers.fieldPassword')}</label>
              <button
                type="button"
                onClick={() => {
                  setPassword(generateTempPassword(tempLength));
                  setShowPassword(true);
                }}
                className="flex items-center gap-1 text-xs font-semibold"
                style={{ color: 'var(--accent-text)' }}
              >
                <RefreshCw className="w-3 h-3" /> {t('orgUsers.generatePassword')}
              </button>
            </div>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder={t('orgUsers.passwordPlaceholder')}
                style={{ ...inputStyle, paddingInlineEnd: 40, fontFamily: showPassword ? 'var(--font-mono, monospace)' : undefined }}
                autoComplete="new-password"
              />
              <button type="button" onClick={() => setShowPassword(v => !v)} className="absolute end-3 top-1/2 -translate-y-1/2" aria-label={t('orgUsers.fieldPassword')}>
                {showPassword
                  ? <EyeOff className="w-4 h-4" style={{ color: 'var(--text-muted)' }} />
                  : <Eye className="w-4 h-4" style={{ color: 'var(--text-muted)' }} />}
              </button>
            </div>
            <p className="mt-1.5 text-[11px] flex items-center gap-1" style={{ color: 'var(--text-muted)' }}>
              <ShieldCheck className="w-3 h-3" /> {t('orgUsers.temporaryPasswordHint')}
            </p>
          </div>

          {/* Role */}
          <div>
            <label className="text-xs font-semibold block mb-1.5" style={{ color: 'var(--text-muted)' }}>{t('orgUsers.fieldRole')}</label>
            <Select value={role} onChange={e => setRole(e.target.value as UserRole)} style={selectStyle}>
              {roleOptions.map(o => (
                <option key={o.role} value={o.role}>{o.label}</option>
              ))}
            </Select>
          </div>

          {/* Facility. Locked when a facility opened this dialog — the account
              belongs to the facility whose Staff tab you are standing in, and
              a picker there is a question with one right answer. */}
          {needsHospital && lockedHospital && (
            <div>
              <label className="text-xs font-semibold block mb-1.5" style={{ color: 'var(--text-muted)' }}>{t('orgUsers.fieldAssignedHospital')}</label>
              <div
                className="flex items-center gap-2 rounded px-3 py-2.5 text-sm"
                style={{ background: 'var(--overlay-subtle)', border: '1px solid var(--border-light)', color: 'var(--text-primary)' }}
                data-field="locked-facility"
              >
                <Building2 className="w-4 h-4" style={{ color: 'var(--text-muted)' }} /> {lockedHospital.name}
              </div>
            </div>
          )}
          {needsHospital && !lockedHospital && hospitals.length === 0 && (
            /* A facility-scoped role with no facility to scope it to. The
               picker used to render empty here and the submit answered
               "Please select a hospital for this role" — an instruction the
               admin had no way to follow. */
            <div
              className="rounded-lg px-3 py-2.5 text-xs"
              style={{ background: 'var(--overlay-subtle)', border: '1px solid var(--border-light)', color: 'var(--text-secondary)' }}
              data-field="no-facilities"
            >
              <p className="mb-1.5" style={{ color: 'var(--text-primary)' }}>{t('orgUsers.noFacilitiesTitle')}</p>
              <p className="mb-2">{t('orgUsers.noFacilitiesBody')}</p>
              <button
                type="button"
                onClick={() => {
                  // Create it here. Routing away used to discard the
                  // half-filled account — including its generated temporary
                  // password — and there was no route back.
                  if (onAddFacility && canCreateFacilities(currentUser?.role ?? '')) onAddFacility();
                  else router.push('/admin/organizations');
                }}
                className="btn btn-secondary btn-sm"
                data-action="add-facility-inline"
              >
                <Building2 className="w-4 h-4" /> {t('orgUsers.noFacilitiesAction')}
              </button>
            </div>
          )}
          {needsHospital && !lockedHospital && hospitals.length > 0 && (
            <div>
              <label className="text-xs font-semibold block mb-1.5" style={{ color: 'var(--text-muted)' }}>{t('orgUsers.fieldAssignedHospital')}</label>
              <Select value={hospitalId} onChange={e => setHospitalId(e.target.value)} style={selectStyle}>
                <option value="">{t('orgUsers.selectHospitalOption')}</option>
                {hospitals.map(h => (
                  <option key={h._id} value={h._id}>{h.name}</option>
                ))}
              </Select>
            </div>
          )}

          {error && (
            <p className="text-xs" style={{ color: 'var(--color-danger-text)' }}>{error}</p>
          )}
        </div>

        <div className="sadb-modal-actions">
          <button type="button" className="btn btn-secondary btn-sm" onClick={onClose} disabled={creating}>
            {t('action.cancel')}
          </button>
          <button type="button" className="btn btn-primary btn-sm" onClick={handleCreate} disabled={creating} data-action="submit-create-user">
            {creating ? t('orgHospitals.creating') : t('orgUsers.createUser')}
          </button>
        </div>
      </div>
    </Modal>
  );
}
