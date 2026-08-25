'use client';

/**
 * The tenant tree's create dialogs — organization, facility, staff account —
 * hosted wherever the button that opens them lives.
 *
 * Extracted for the admin dashboards' greeting actions (2026-08-25). Those
 * three buttons used to route to `/manage?...&new=1` and let the management
 * workspace open the dialog, which took an operator off the board they were
 * reading in order to create one record, and left them on a list they had not
 * asked for afterwards. The forms hosted here are the same components the
 * workspace hosts — `OrganizationForm`, `FacilityFormModal`, `CreateUserModal`
 * — so nothing is forked; only the frame around them moved.
 *
 * Two duties belong to the host rather than the form:
 *
 *  • The one-time credential hand-off. A form unmounts the moment it reports
 *    success, so it hands the credentials up; this component therefore stays
 *    mounted until the hand-off panel is dismissed, not until the form closes.
 *  • The facility → first account continuation, which is the same journey the
 *    workspace runs: a facility with nobody in it cannot be used yet.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Modal from '@/components/Modal';
import PopupHeader from '@/components/PopupHeader';
import { useToast } from '@/components/Toast';
import { useApp } from '@/lib/context';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { useOrganizations } from '@/lib/hooks/useOrganizations';
import { canCreateUsers } from '@/lib/people-nav';
import { OrganizationForm } from '@/components/admin/OrganizationForm';
import FacilityFormModal from '@/components/admin/FacilityFormModal';
import { CreateUserModal, CredentialHandoffModal, type CreatedCredentials } from '@/modules/identity/client';
import type { HospitalDoc } from '@/lib/db-types';
import type { TenancyCreateKind } from '../index';

interface PendingHandoff {
  credentials: CreatedCredentials;
  /** Which flow produced them — the panel's copy differs. */
  from: 'organization' | 'staff';
}

export default function TenancyCreateDialogs({ kind, onDone }: {
  /** What to open. Mount this component only while something is open. */
  kind: TenancyCreateKind;
  /** Everything is finished or dismissed — the host may unmount this. */
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const { currentUser } = useApp();
  const { showToast } = useToast();
  const [step, setStep] = useState<TenancyCreateKind>(kind);
  const [newFacility, setNewFacility] = useState<HospitalDoc | null>(null);
  const [handoff, setHandoff] = useState<PendingHandoff | null>(null);

  /* Every role but the platform operator is already inside exactly one tenant,
     so the dialogs are fixed to it and never ask which organization. The
     super-admin has no such scope here — there is no rail on a dashboard to
     have chosen one — so the facility form offers the picker instead. */
  const scopedOrgId = currentUser && currentUser.role !== 'super_admin' ? currentUser.orgId ?? '' : '';
  const { organizations } = useOrganizations(!scopedOrgId);

  if (!currentUser) return null;

  if (handoff) {
    const isOrg = handoff.from === 'organization';
    return (
      <CredentialHandoffModal
        title={t(isOrg ? 'orgAdmin.handoffTitle' : 'adminUsers.handoffCreatedTitle')}
        description={t(isOrg ? 'orgAdmin.handoffDescription' : 'adminUsers.handoffDescription')}
        username={handoff.credentials.username}
        password={handoff.credentials.password}
        invitation={handoff.credentials.invitation}
        onClose={onDone}
      />
    );
  }

  if (step === 'organization') {
    return (
      <Modal onClose={onDone} width={920} labelledBy="tenancy-create-organization">
        <div className="sadb-modal mgmt-form-modal">
          <PopupHeader
            titleId="tenancy-create-organization"
            title={t('management.addOrganization')}
            onClose={onDone}
            onExpand={() => {
              onDone();
              router.push('/admin/organizations/new');
            }}
          />
          <OrganizationForm
            onCancel={onDone}
            onSaved={({ handoff: created }) => {
              if (created) setHandoff({ credentials: created, from: 'organization' });
              else onDone();
            }}
          />
        </div>
      </Modal>
    );
  }

  if (step === 'facility') {
    return (
      <FacilityFormModal
        orgId={scopedOrgId || undefined}
        organizations={scopedOrgId ? undefined : organizations}
        actor={{ _id: currentUser._id, username: currentUser.username }}
        brandColor={currentUser.branding?.primaryColor || 'var(--accent-primary)'}
        onClose={onDone}
        onSaved={facility => {
          showToast(t('orgHospitals.createdToast', { name: facility.name }), 'success');
          // Continue at the record just created, exactly as the management
          // workspace does: the facility is on the server before the account
          // form mounts, so its assignment picker fetches a list that already
          // contains it.
          if (canCreateUsers(currentUser.role)) {
            setNewFacility(facility);
            setStep('staff');
          } else {
            onDone();
          }
        }}
      />
    );
  }

  return (
    <CreateUserModal
      hospitals={newFacility ? [newFacility] : []}
      presetOrgId={newFacility?.orgId || scopedOrgId || undefined}
      presetHospitalId={newFacility?._id}
      lockFacility={!!newFacility}
      onClose={onDone}
      onCreated={credentials => setHandoff({ credentials, from: 'staff' })}
    />
  );
}
