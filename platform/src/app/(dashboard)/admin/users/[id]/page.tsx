'use client';

/**
 * One staff account, as a full page — what the roster row opens.
 *
 * This replaces a 520px dialog that carried thirteen facts and six actions, of
 * which four opened a SECOND dialog. The card had to close itself as each one
 * opened so they would not stack, so every consequential action began by
 * destroying the context it was about. On a page the record stays on screen
 * while its confirmation sits over it, and the operator can still read who they
 * are about to deactivate.
 *
 * Destructive actions keep their confirm dialogs: they are irreversible, and a
 * dialog's forced focus is what a delete should cost. Reversible ones
 * (reactivate, resend an invitation) just run.
 */

import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { useApp } from '@/lib/context';
import { useToast } from '@/components/Toast';
import { useOrganizations } from '@/lib/hooks/useOrganizations';
import {
  ArrowLeft, Shield, KeyRound, Mail, UserX, UserCheck, Trash2, Building2,
} from '@/components/icons/lucide';
import { SadbPage, SadbCard, SadbKvRow, SadbConfirmModal } from '@/components/admin/sadb-ui';
import Select from '@/components/Select';
import {
  CredentialHandoffModal, canResendInvite, describeAccountState,
  generateTempPassword, usePasswordPolicy,
} from '@/modules/identity/client';
import type { InvitationOutcome } from '@/modules/identity/client';
import { avatarTint } from '@/lib/patient-utils';
import { getRoleConfig } from '@/lib/permissions';
import { formatDate } from '@/lib/format-utils';
import type { UserDoc, UserRole } from '@/lib/db-types';

const ROLE_OPTIONS: UserRole[] = [
  'doctor', 'clinical_officer', 'nurse', 'midwife', 'lab_tech', 'pharmacist',
  'radiologist', 'nutritionist', 'front_desk', 'cashier', 'medical_biller',
  'data_entry_clerk', 'hrio', 'records_hmis_officer', 'medical_superintendent',
  'hospital_manager', 'org_admin', 'government', 'county_health_director',
  'central_registration_clerk', 'clinic_clerk', 'triage_nurse', 'rooming_nurse',
  'clinician',
];

export default function AdminUserDetailPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const userId = params?.id ?? '';
  const { currentUser } = useApp();
  const { showToast } = useToast();
  const { organizations } = useOrganizations();
  const { tempLength } = usePasswordPolicy();

  const [user, setUser] = useState<UserDoc | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  // One dialog at a time, and only for the actions that deserve one.
  const [confirm, setConfirm] = useState<null | 'deactivate' | 'delete'>(null);
  const [roleOpen, setRoleOpen] = useState(false);
  const [newRole, setNewRole] = useState<UserRole>('nurse');
  const [resetOpen, setResetOpen] = useState(false);
  const [handoff, setHandoff] = useState<{ username: string; password: string; invitation?: InvitationOutcome } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { getUserById } = await import('@/modules/identity/services/user-service');
        const found = await getUserById(userId);
        if (!cancelled) { setUser(found ?? null); setNewRole((found?.role as UserRole) ?? 'nurse'); }
      } catch {
        if (!cancelled) setUser(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [userId]);

  const roleLabel = (role: string) => t(`adminUsers.role_${role}`);
  const orgName = useMemo(() => {
    if (!user?.orgId) return null;
    return organizations.find(o => o._id === user.orgId)?.name ?? user.orgId;
  }, [organizations, user]);

  const backToRoster = () => router.push('/admin/users');

  const run = async (fn: () => Promise<void>, done: string) => {
    if (!currentUser) return;
    setBusy(true);
    try {
      await fn();
      showToast(done, 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : t('adminUsers.actionFailed'), 'error');
    } finally {
      setBusy(false);
    }
  };

  const changeRole = () => run(async () => {
    const { updateUser } = await import('@/modules/identity/services/user-service');
    await updateUser(userId, { role: newRole } as Partial<UserDoc>, currentUser!._id, currentUser!.username);
    setUser(u => (u ? { ...u, role: newRole } : u));
    setRoleOpen(false);
  }, t('adminUsers.roleChanged', { name: user?.name ?? '', role: roleLabel(newRole) }));

  const resetPassword = () => run(async () => {
    const password = generateTempPassword(tempLength);
    const { resetPassword: reset } = await import('@/modules/identity/services/user-service');
    await reset(userId, password, currentUser!._id, currentUser!.username);
    setResetOpen(false);
    setHandoff({ username: user!.username, password });
  }, t('adminUsers.passwordReset', { name: user?.name ?? '' }));

  const resendInvite = () => run(async () => {
    const { resendUserInvite } = await import('@/modules/identity/services/user-service');
    await resendUserInvite(userId);
  }, t('adminUsers.invitationSent', { name: user?.name ?? '' }));

  const setActive = (active: boolean) => run(async () => {
    const svc = await import('@/modules/identity/services/user-service');
    if (active) await svc.reactivateUser(userId, currentUser!._id, currentUser!.username);
    else await svc.deactivateUser(userId, currentUser!._id, currentUser!.username);
    setUser(u => (u ? { ...u, isActive: active } : u));
    setConfirm(null);
  }, active
    ? t('adminUsers.activated', { name: user?.name ?? '' })
    : t('adminUsers.deactivated', { name: user?.name ?? '' }));

  const remove = () => run(async () => {
    const { deleteUser } = await import('@/modules/identity/services/user-service');
    await deleteUser(userId, currentUser!._id, currentUser!.username);
    setConfirm(null);
    backToRoster();
  }, t('adminUsers.deletedUser', { name: user?.name ?? '' }));

  if (loading) {
    return (
      <SadbPage>
        <p className="sadb-empty">{t('adminUsers.loadingUser')}</p>
      </SadbPage>
    );
  }

  if (!user) {
    return (
      <SadbPage>
        <div className="patient-registration-toolbar">
          <button type="button" onClick={backToRoster} className="patient-registration-back">
            <ArrowLeft className="w-4 h-4" /> {t('adminUsers.backToUsers')}
          </button>
        </div>
        <p className="sadb-empty">{t('adminUsers.userNotFound')}</p>
      </SadbPage>
    );
  }

  const initials = user.name.split(' ').filter(Boolean).map(n => n[0]).join('').slice(0, 2).toUpperCase() || '?';
  const account = describeAccountState(user);

  return (
    <SadbPage>
      <div className="patient-registration-toolbar">
        <button type="button" onClick={backToRoster} className="patient-registration-back">
          <ArrowLeft className="w-4 h-4" /> {t('adminUsers.backToUsers')}
        </button>
      </div>

      {/* Identity on the left, the actions on the right — one line, the same
          header shape /admin/organizations/[id] uses. */}
      <div className="sadb-userpage-head">
        <div className="ehr-patient-icon" style={avatarTint(user.name)}>{initials}</div>
        <div className="sadb-userpage-id">
          <h1>{user.name}</h1>
          <p>{user.username} · {roleLabel(user.role)}</p>
        </div>
        <div className="sadb-userpage-actions">
          <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => setRoleOpen(true)}>
            <Shield className="w-4 h-4" /> {t('adminUsers.changeRole')}
          </button>
          <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => setResetOpen(true)}>
            <KeyRound className="w-4 h-4" /> {t('adminUsers.resetPassword')}
          </button>
          {/* Preferred over a reset: the person sets their own password from a
              single-use link, so no plaintext credential has to be relayed. */}
          {canResendInvite(user) && (
            <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={resendInvite}>
              <Mail className="w-4 h-4" /> {t('adminUsers.resendInvite')}
            </button>
          )}
          {user.hospitalId && (
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => router.push(`/admin/facilities/${encodeURIComponent(user.hospitalId!)}`)}
            >
              <Building2 className="w-4 h-4" /> {t('adminUsers.openFacility')}
            </button>
          )}
          {/* Deactivating is destructive — it routes through the confirm
              dialog. Reactivating is one reversible click, so it runs. */}
          {user.isActive ? (
            <button type="button" className="btn btn-sm sadb-btn-danger" disabled={busy} onClick={() => setConfirm('deactivate')}>
              <UserX className="w-4 h-4" /> {t('adminUsers.deactivate')}
            </button>
          ) : (
            <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => setActive(true)}>
              <UserCheck className="w-4 h-4" /> {t('adminUsers.activate')}
            </button>
          )}
          <button
            type="button" className="btn btn-sm sadb-btn-danger" disabled={busy}
            onClick={() => setConfirm('delete')} data-action="delete-user"
          >
            <Trash2 className="w-4 h-4" /> {t('action.delete')}
          </button>
        </div>
      </div>

      <SadbCard title={t('adminUsers.accountDetails')}>
        <SadbKvRow label={t('adminUsers.colStatus')} value={user.isActive ? t('adminUsers.statusActive') : t('adminUsers.statusInactive')} />
        <SadbKvRow label={t('adminUsers.colRole')} value={roleLabel(user.role)} />
        <SadbKvRow label={t('adminUsers.workspace')} value={getRoleConfig(user.role)?.label ?? '—'} />
        <SadbKvRow label={t('adminUsers.colOrganization')} value={orgName ?? t('adminUsers.platformLevel')} />
        <SadbKvRow label={t('adminUsers.colHospital')} value={user.hospitalName || t('adminUsers.facilityUnassigned')} />
        <SadbKvRow label={t('adminUsers.department')} value={user.department || '—'} />
        <SadbKvRow label={t('adminUsers.specialty')} value={user.specialty || '—'} />
        <SadbKvRow label={t('adminUsers.email')} value={user.email || '—'} />
        <SadbKvRow label={t('adminUsers.phone')} value={user.phone || '—'} />
        <SadbKvRow label={t('adminUsers.credentials')} value={account.label} />
        <SadbKvRow
          label={t('adminUsers.lastSignIn')}
          value={user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleString() : t('adminUsers.never')}
        />
        <SadbKvRow label={t('adminUsers.created')} value={user.createdAt ? formatDate(user.createdAt) : '—'} />
        {user.deactivatedAt && (
          <SadbKvRow
            label={t('adminUsers.deactivatedOn')}
            value={`${formatDate(user.deactivatedAt)}${user.deactivatedBy ? ` · ${user.deactivatedBy}` : ''}`}
          />
        )}
        <SadbKvRow label={t('adminUsers.userId')} value={<code>{user._id}</code>} />
      </SadbCard>

      {roleOpen && (
        <SadbConfirmModal
          title={t('adminUsers.changeRoleTitle', { name: user.name })}
          body={
            <div className="sadb-rolepick">
              <p>{t('adminUsers.changeRoleBody')}</p>
              <Select value={newRole} onChange={e => setNewRole(e.target.value as UserRole)}>
                {ROLE_OPTIONS.map(r => <option key={r} value={r}>{roleLabel(r)}</option>)}
              </Select>
            </div>
          }
          confirmLabel={t('adminUsers.changeRole')}
          onCancel={() => setRoleOpen(false)}
          onConfirm={changeRole}
          busy={busy}
        />
      )}

      {resetOpen && (
        <SadbConfirmModal
          title={t('adminUsers.resetPasswordTitle', { name: user.name })}
          body={t('adminUsers.resetPasswordBody', { name: user.name })}
          confirmLabel={t('adminUsers.resetPassword')}
          onCancel={() => setResetOpen(false)}
          onConfirm={resetPassword}
          busy={busy}
        />
      )}

      {confirm === 'deactivate' && (
        <SadbConfirmModal
          title={t('adminUsers.deactivateTitle', { name: user.name })}
          body={t('adminUsers.deactivateBody', { name: user.name })}
          confirmLabel={t('adminUsers.deactivate')}
          onCancel={() => setConfirm(null)}
          onConfirm={() => setActive(false)}
          busy={busy}
        />
      )}

      {confirm === 'delete' && (
        <SadbConfirmModal
          title={t('adminUsers.deleteTitle', { name: user.name })}
          body={t('adminUsers.deleteBody', { name: user.name })}
          confirmLabel={t('action.delete')}
          onCancel={() => setConfirm(null)}
          onConfirm={remove}
          busy={busy}
        />
      )}

      {handoff && (
        <CredentialHandoffModal
          title={t('adminUsers.handoffResetTitle')}
          description={t('adminUsers.handoffResetDescription')}
          username={handoff.username}
          password={handoff.password}
          invitation={handoff.invitation}
          onClose={() => setHandoff(null)}
        />
      )}
    </SadbPage>
  );
}
