'use client';

import Modal from '@/components/Modal';
import PopupHeader from '@/components/PopupHeader';
import { UserForm } from '@/components/admin/UserForm';
import type { InvitationOutcome } from '@/modules/identity/provisioning/user-invite';
import type { HospitalDoc } from '@/lib/db-types';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { useRouter } from 'next/navigation';

export interface CreatedCredentials {
  username: string;
  password: string;
  invitation?: InvitationOutcome;
}

/** Modal host for the platform's single account editor. */
export default function CreateUserModal({
  hospitals,
  presetOrgId,
  presetHospitalId,
  lockFacility = false,
  onClose,
  onCreated,
  onAddFacility,
}: {
  hospitals: HospitalDoc[];
  /** Keep the tenant scope even while a newly created facility is being
   * fetched into the server-authoritative assignment list. */
  presetOrgId?: string;
  presetHospitalId?: string;
  lockFacility?: boolean;
  onClose: () => void;
  onCreated: (credentials: CreatedCredentials) => void | Promise<void>;
  onAddFacility?: () => void;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const preset = hospitals.find(hospital => hospital._id === presetHospitalId);
  const expandToPage = () => {
    const query = new URLSearchParams();
    query.set('returnTo', `${window.location.pathname}${window.location.search}`);
    if (presetOrgId || preset?.orgId) query.set('org', presetOrgId || preset?.orgId || '');
    if (presetHospitalId) query.set('facility', presetHospitalId);
    onClose();
    router.push(`/admin/users/new?${query.toString()}`);
  };
  return (
    <Modal onClose={onClose} width={620} labelledBy="create-user-title">
      <div className="sadb-modal mgmt-user-modal">
        <PopupHeader
          titleId="create-user-title"
          title={t('orgUsers.createNewUser')}
          subtitle={preset ? t('hospitals.addUserForFacility', { name: preset.name }) : undefined}
          onExpand={expandToPage}
          onClose={onClose}
        />
        <UserForm
          presetOrgId={presetOrgId || preset?.orgId}
          presetHospitalId={presetHospitalId}
          lockOrganization={!!preset?.orgId}
          lockFacility={lockFacility}
          onCancel={onClose}
          onAddFacility={onAddFacility}
          onSaved={({ handoff }) => void onCreated(handoff)}
        />
      </div>
    </Modal>
  );
}
