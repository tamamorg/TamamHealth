'use client';
import type { ToastType, ToastOptions } from '@/components/Toast';
import type { ConfirmPromptOptions } from '@/components/ConfirmDialog';
import { patientFullName } from '@/lib/patient-utils';
import type { PatientDoc } from '@/lib/db-types';
import type { AppUser } from '@/lib/context/types';
import { describeError } from '@/lib/user-facing-error';
export function buildHandleEndAssignment({ patient, currentUser, confirmPrompt, showToast, reloadPatients }: {
  patient: PatientDoc | null | undefined;
  currentUser: AppUser | null;
  confirmPrompt: (options: ConfirmPromptOptions) => Promise<string | null>;
  showToast: (message: string, type?: ToastType | undefined, opts?: ToastOptions | undefined) => void;
  reloadPatients: () => Promise<void>;
}) {
  const handleEndAssignment = async () => {
    if (!patient || !currentUser) return;
    const displayName = patientFullName(patient);
    const reason = await confirmPrompt({
      title: `End the assignment for ${displayName}?`,
      message: 'They will leave the assigned worklists; their record is unaffected. The reason is kept in the audit trail.',
      confirmLabel: 'End assignment',
      tone: 'danger',
      inputLabel: 'Reason',
      inputPlaceholder: 'e.g. Patient left and has not returned; care handed to the ward team…',
      inputRequired: true,
    });
    if (reason === null) return;
    try {
      const { completePatientAssignment } = await import('@/lib/services/patient-assignment-service');
      await completePatientAssignment({
        patientId: patient._id,
        patientName: displayName,
        reason,
        actor: { id: currentUser._id, name: currentUser.name, role: currentUser.role },
      });
      showToast(`Assignment for ${displayName} ended.`, 'success');
      // The header's care-team line and the ⋯ menu both read the patient doc.
      await reloadPatients();
    } catch (err) {
      showToast(describeError(err, 'Assignment not ended. Try again.'), 'error');
    }
  };
  return handleEndAssignment;
}
