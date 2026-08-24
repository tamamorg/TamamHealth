'use client';

import Modal from '@/components/Modal';
import { UserForm } from '@/components/admin/UserForm';
import type { InvitationOutcome } from '@/modules/identity/provisioning/user-invite';
import type { HospitalDoc } from '@/lib/db-types';
import { useTranslation } from '@/lib/i18n/useTranslation';

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
  const preset = hospitals.find(hospital => hospital._id === presetHospitalId);
  return (
    <Modal onClose={onClose} width={620} labelledBy="create-user-title">
      <div className="sadb-modal mgmt-user-modal">
        <div className="sadb-modal-copy">
          <h2 id="create-user-title" className="sadb-modal-title">{t('orgUsers.createNewUser')}</h2>
          {preset && <p className="sadb-modal-sub">{t('hospitals.addUserForFacility', { name: preset.name })}</p>}
        </div>
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
